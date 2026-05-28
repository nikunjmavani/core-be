import { createHmac } from 'node:crypto';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { buildOutboundCallOptions, outboundCall } from '@/infrastructure/outbound/index.js';
import { createPinnedWebhookFetch } from '@/shared/utils/security/webhook-outbound-fetch.util.js';
import { getWebhookWorkerOptions } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import {
  fetchWebhookWithCircuitBreaker,
  webhookDeliveryBackoffWithJitter,
} from '@/domains/notify/sub-domains/webhook/workers/webhook-outbound-circuit.js';
import { getWorkerConcurrencyWebhook } from '@/shared/config/worker-concurrency.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { webhookDeliveryJobDataSchema } from '../queues/webhook-delivery.job.schema.js';
import {
  WEBHOOK_DELIVERY_QUEUE_NAME,
  type WebhookDeliveryJobData,
} from '../queues/webhook-delivery.queue.js';
import { parseBullMQJobData } from '@/shared/utils/validation/bullmq-job-validation.util.js';
import { createWorkerWebhookDeliveryQueries } from '@/domains/notify/sub-domains/webhook/webhook-delivery.repository.js';
import {
  createWorkerWebhookDeliveryAttemptRepository,
  type WebhookDeliveryAttemptRepository,
} from '@/domains/notify/sub-domains/webhook/webhook-delivery-attempt.repository.js';
import { decryptFieldSecret } from '@/shared/utils/security/field-secret-encryption.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import {
  createTenantScopedBullMQWorker,
  type WorkerDatabaseHandle,
} from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-database.context.js';

/**
 * Sign a webhook payload with HMAC-SHA256 (Stripe-style signature).
 */
function signPayload(secret: string, payload: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(signedPayload).digest('hex');
}

/**
 * Type of the outbound fetch implementation used by the webhook delivery worker — kept as a
 * separate alias so unit tests can swap in a mock without `as unknown as typeof fetch`.
 *
 * @remarks
 * - **Algorithm:** identical signature to the global `fetch`.
 * - **Failure modes:** errors propagate from the underlying implementation.
 * - **Side effects:** none on its own.
 * - **Notes:** the worker substitutes a DNS-pinned, allowlisted `fetch` for production calls
 *   and accepts the raw global `fetch` only as the test default.
 */
export type WebhookDeliveryFetch = typeof fetch;

const defaultWebhookDeliveryFetch = globalThis.fetch;

/**
 * Delivers a single webhook attempt (testable with an injected fetch implementation).
 *
 * @remarks
 * - **Algorithm:** open `withOrganizationContext(organizationPublicId)` → resolve the delivery
 *   attempt + webhook secret → atomically transition `PENDING → SENDING` (or reclaim a stale
 *   `SENDING` lease, or no-op when `already_sent` / `in_flight`) → HMAC-SHA256 sign
 *   `<timestamp>.<payload>` → POST through the per-URL circuit breaker / DNS-pinned fetch →
 *   record `SENT` (2xx) or `FAILED` with truncated response body.
 * - **Failure modes:** rethrows any error after writing a `FAILED` outcome with `next_retry_at`
 *   for the next exponential backoff slot (10s × 2^attemptsMade for the first 4 retries; null
 *   on the final attempt so BullMQ promotes the job to the DLQ via `dead-letter.ts`).
 *   `attempt_not_found` short-circuits without writing a failure record.
 * - **Side effects:** outbound HTTPS POST; updates to `webhook_delivery_attempts`; structured
 *   logs at every transition.
 * - **Notes:** the dependency-injection seam (`fetchImplementation`,
 *   `deliveryAttemptRepository`) is exclusively for unit tests; production paths must use the
 *   pinned fetch and the worker-scoped repository factories.
 */
export async function processWebhookDeliveryAttempt(
  deliveryAttemptId: number,
  organizationPublicId: string,
  jobContext: { id?: string; attemptsMade: number; requestId?: string },
  fetchImplementation: WebhookDeliveryFetch = globalThis.fetch,
  deliveryAttemptRepository?: WebhookDeliveryAttemptRepository,
): Promise<{ httpStatus: number; success: true }> {
  try {
    return await withOrganizationContext(organizationPublicId, async (databaseHandle) => {
      const attemptRepository =
        deliveryAttemptRepository ?? createWorkerWebhookDeliveryAttemptRepository(databaseHandle);
      return processWebhookDeliveryAttemptInContext(
        databaseHandle,
        deliveryAttemptId,
        organizationPublicId,
        jobContext,
        fetchImplementation,
        attemptRepository,
      );
    });
  } catch (error) {
    const shouldRecordFailure = !(
      error instanceof Error && error.message.startsWith('webhook.delivery.attempt_not_found:')
    );
    if (deliveryAttemptRepository === undefined && shouldRecordFailure) {
      await withOrganizationContext(organizationPublicId, async (databaseHandle) => {
        const attemptRepository = createWorkerWebhookDeliveryAttemptRepository(databaseHandle);
        await attemptRepository.recordOutcome(deliveryAttemptId, {
          status: 'FAILED',
          response_body: error instanceof Error ? error.message : 'Unknown error',
          next_retry_at:
            jobContext.attemptsMade < 4
              ? new Date(Date.now() + 10_000 * 2 ** jobContext.attemptsMade)
              : null,
        });
      });
    }
    throw error;
  }
}

async function processWebhookDeliveryAttemptInContext(
  databaseHandle: WorkerDatabaseHandle,
  deliveryAttemptId: number,
  organizationPublicId: string,
  jobContext: { id?: string; attemptsMade: number; requestId?: string },
  fetchImplementation: WebhookDeliveryFetch,
  deliveryAttemptRepository: WebhookDeliveryAttemptRepository,
): Promise<{ httpStatus: number; success: true }> {
  const webhookDeliveryQueries = createWorkerWebhookDeliveryQueries(databaseHandle);
  const deliveryContext = await webhookDeliveryQueries.findWebhookDeliveryAttemptWithWebhook(
    deliveryAttemptId,
    organizationPublicId,
  );
  if (!deliveryContext) {
    throw new Error(`webhook.delivery.attempt_not_found:${String(deliveryAttemptId)}`);
  }

  const { webhookId, webhookUrl, encryptedSecret, eventType, payload } = deliveryContext;
  const payloadString = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signingSecret = decryptFieldSecret(encryptedSecret);
  const signature = signPayload(signingSecret, payloadString, timestamp);

  logger.info(
    {
      jobId: jobContext.id,
      requestId: jobContext.requestId,
      deliveryAttemptId,
      webhookId,
      eventType,
      url: webhookUrl,
      attempt: jobContext.attemptsMade + 1,
    },
    'webhook.delivery.sending',
  );

  const sendingClaim = await deliveryAttemptRepository.tryMarkSending(
    deliveryAttemptId,
    jobContext.attemptsMade + 1,
  );
  if (sendingClaim === 'already_sent') {
    logger.info(
      { deliveryAttemptId, requestId: jobContext.requestId },
      'webhook.delivery.already_sent',
    );
    return { httpStatus: 200, success: true };
  }
  if (sendingClaim === 'in_flight') {
    logger.info(
      { deliveryAttemptId, requestId: jobContext.requestId },
      'webhook.delivery.in_flight',
    );
    return { httpStatus: 200, success: true };
  }

  try {
    const pinnedFetch =
      fetchImplementation === defaultWebhookDeliveryFetch
        ? await createPinnedWebhookFetch(webhookUrl)
        : fetchImplementation;

    const response = await outboundCall(
      buildOutboundCallOptions({
        name: 'webhook',
        circuit: null,
        requestId: jobContext.requestId,
        operation: async (signal) =>
          fetchWebhookWithCircuitBreaker(
            webhookUrl,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Signature': `t=${timestamp},v1=${signature}`,
                'X-Webhook-Event': eventType,
                'X-Webhook-Timestamp': String(timestamp),
                ...(jobContext.requestId ? { 'X-Request-Id': jobContext.requestId } : {}),
              },
              body: payloadString,
              signal,
            },
            pinnedFetch,
          ),
      }),
    );

    let responseBody: string;
    try {
      responseBody = await response.text();
    } catch (parseError) {
      logger.warn(
        {
          jobId: jobContext.id,
          requestId: jobContext.requestId,
          deliveryAttemptId,
          webhookId,
          url: webhookUrl,
          parseError: parseError instanceof Error ? parseError.message : 'Unknown error',
        },
        'webhook.response.body.parse.failed',
      );
      responseBody = '[parse error]';
    }
    const httpStatus = response.status;
    const isSuccess = httpStatus >= 200 && httpStatus < 300;

    await deliveryAttemptRepository.recordOutcome(deliveryAttemptId, {
      status: isSuccess ? 'SENT' : 'FAILED',
      http_status_code: httpStatus,
      response_body: responseBody.slice(0, 2000),
    });

    if (!isSuccess) {
      throw new Error(`Webhook delivery failed with HTTP ${httpStatus}`);
    }

    return { httpStatus, success: true };
  } catch (error) {
    await deliveryAttemptRepository.recordOutcome(deliveryAttemptId, {
      status: 'FAILED',
      response_body: error instanceof Error ? error.message : 'Unknown error',
      next_retry_at:
        jobContext.attemptsMade < 4
          ? new Date(Date.now() + 10_000 * 2 ** jobContext.attemptsMade)
          : null,
    });

    throw error;
  }
}

/**
 * Creates a BullMQ worker that delivers outbound webhooks with HMAC signing.
 *
 * @remarks
 * - **Algorithm:** registers a tenant-scoped BullMQ worker on
 *   {@link WEBHOOK_DELIVERY_QUEUE_NAME} that parses the job payload through
 *   {@link webhookDeliveryJobDataSchema}, opens the organization database scope, and delegates
 *   to {@link processWebhookDeliveryAttempt} for the actual HMAC-signed POST.
 * - **Failure modes:** delivery failures (timeout, non-2xx, network error) are persisted on
 *   the attempt row and rethrown so BullMQ retries up to 5 times using the custom backoff
 *   {@link webhookDeliveryBackoffWithJitter} (~10s × 2^attempt with up to 30% jitter); the
 *   final failure routes the job to the per-queue DLQ via the bootstrap dead-letter wiring.
 * - **Side effects:** subscribes a `Worker` to Redis with webhook-tuned options; performs
 *   outbound HTTPS calls via a pinned fetch wrapped in a per-URL circuit breaker; writes the
 *   audit trail to `notify.webhook_delivery_attempts`.
 * - **Notes:** concurrency comes from `getWorkerConcurrencyWebhook()`; the returned handle is
 *   wired into bootstrap for graceful shutdown and lock release.
 */
export function createWebhookDeliveryWorker(): WorkerHandle {
  const workerHandle = createTenantScopedBullMQWorker<WebhookDeliveryJobData>(
    WEBHOOK_DELIVERY_QUEUE_NAME,
    async (databaseHandle, job) => {
      const { deliveryAttemptId, organizationPublicId, requestId } = parseBullMQJobData(
        webhookDeliveryJobDataSchema,
        job.data,
        WEBHOOK_DELIVERY_QUEUE_NAME,
      );
      return processWebhookDeliveryAttemptInContext(
        databaseHandle,
        deliveryAttemptId,
        organizationPublicId,
        omitUndefined({
          id: job.id,
          attemptsMade: job.attemptsMade,
          requestId,
        }),
        globalThis.fetch,
        createWorkerWebhookDeliveryAttemptRepository(databaseHandle),
      );
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: getWorkerConcurrencyWebhook(),
      ...getWebhookWorkerOptions(),
      settings: {
        backoffStrategy: webhookDeliveryBackoffWithJitter,
      },
    },
  );

  workerHandle.worker?.on('stalled', (jobId) => {
    logger.warn({ jobId, queue: WEBHOOK_DELIVERY_QUEUE_NAME }, 'webhook.delivery.stalled');
  });

  workerHandle.worker?.on('completed', (job) => {
    logger.info({ jobId: job?.id }, 'webhook.delivery.completed');
  });

  return workerHandle;
}
