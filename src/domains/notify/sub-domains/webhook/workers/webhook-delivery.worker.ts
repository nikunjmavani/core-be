import { createHmac } from 'node:crypto';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
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
import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-context.js';

/**
 * Sign a webhook payload with HMAC-SHA256 (Stripe-style signature).
 */
function signPayload(secret: string, payload: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(signedPayload).digest('hex');
}

export type WebhookDeliveryFetch = typeof fetch;

const defaultWebhookDeliveryFetch = globalThis.fetch;

/**
 * Delivers a single webhook attempt (testable with an injected fetch implementation).
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

    const response = await fetchWebhookWithCircuitBreaker(
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
        signal: AbortSignal.timeout(30_000),
      },
      pinnedFetch,
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
