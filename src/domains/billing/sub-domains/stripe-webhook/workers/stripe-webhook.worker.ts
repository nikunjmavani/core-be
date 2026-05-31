import { Worker } from 'bullmq';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { getDefaultWorkerOptions } from '@/infrastructure/queue/worker-runtime/worker-options.js';
import { buildWorkerHandle } from '@/infrastructure/queue/worker-runtime/worker-close.util.js';
import {
  isStripeConfigured,
  isStripeWebhookIngressConfigured,
} from '@/infrastructure/payment/stripe.client.js';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { getWorkerConcurrencyStripe } from '@/shared/config/worker-concurrency.util.js';
import type { BillingContainer } from '@/domains/billing/billing.container.js';
import type { StripeWebhookJobData } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { stripeWebhookBackoffStrategy } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook-backoff.util.js';
import { stripeWebhookJobDataSchema } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.job.schema.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { processStripeWebhookJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.processor.js';
import { parseJobDataOrDeadLetter } from '@/infrastructure/queue/dlq/poison-job.util.js';
import { runWithPropagatedTraceContext } from '@/infrastructure/observability/tracing/trace-context.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Subset of {@link BillingContainer} the Stripe webhook worker actually needs;
 * intentionally narrow so the worker process can compose without pulling in
 * unrelated billing services.
 *
 * @remarks
 * - **Algorithm:** Plain structural type alias.
 * - **Failure modes:** None.
 * - **Side effects:** None.
 * - **Notes:** Source the value from the worker composition root (e.g.
 *   `createWorkerContainers`), not the API process container.
 */
export type StripeWebhookWorkerBillingContainer = Pick<BillingContainer, 'stripeWebhookService'>;

/**
 * BullMQ worker that processes verified Stripe webhook events asynchronously.
 *
 * @remarks
 * - **Algorithm:** Creates a {@link Worker} for {@link STRIPE_WEBHOOK_QUEUE_NAME}
 *   that delegates to {@link processStripeWebhookJob}; concurrency comes from
 *   {@link getWorkerConcurrencyStripe} and retries use
 *   {@link stripeWebhookBackoffStrategy}.
 * - **Failure modes:** Stalled jobs are logged via the `stalled` listener;
 *   processor exceptions trigger the configured backoff for up to the queue's
 *   default attempts.
 * - **Side effects:** Holds a Redis connection until the {@link WorkerHandle}
 *   returned to the caller is closed during shutdown.
 * - **Notes:** Requires billing services from the shared worker composition
 *   root (`createWorkerContainers`); never instantiates services itself.
 */
export function createStripeWebhookWorker(
  billingContainer: StripeWebhookWorkerBillingContainer,
): WorkerHandle {
  const { stripeWebhookService } = billingContainer;
  const worker = new Worker<StripeWebhookJobData>(
    STRIPE_WEBHOOK_QUEUE_NAME,
    async (job) => {
      const jobData = await parseJobDataOrDeadLetter({
        schema: stripeWebhookJobDataSchema,
        job,
        queueName: STRIPE_WEBHOOK_QUEUE_NAME,
      });
      await runWithPropagatedTraceContext(
        { traceparent: jobData.traceparent, tracestate: jobData.tracestate },
        job.name,
        () => processStripeWebhookJob(jobData, stripeWebhookService, job.id),
      );
    },
    {
      connection: getBullMQConnectionOptions(),
      concurrency: getWorkerConcurrencyStripe(),
      ...getDefaultWorkerOptions(),
      settings: {
        backoffStrategy: stripeWebhookBackoffStrategy,
      },
    },
  );

  worker.on('stalled', (jobId) => {
    logger.warn({ jobId, queueName: STRIPE_WEBHOOK_QUEUE_NAME }, 'stripe.webhook.worker.stalled');
  });

  return buildWorkerHandle(worker, STRIPE_WEBHOOK_QUEUE_NAME);
}

/**
 * Returns a {@link createStripeWebhookWorker} only when both Stripe API keys
 * and webhook ingress secrets are configured, otherwise `null`.
 *
 * @remarks
 * - **Algorithm:** Boolean guard combining {@link isStripeConfigured} and
 *   {@link isStripeWebhookIngressConfigured}.
 * - **Failure modes:** None — pure check, no I/O.
 * - **Side effects:** None when the guard short-circuits; otherwise delegates
 *   to {@link createStripeWebhookWorker}.
 * - **Notes:** Lets local/CI environments boot the worker process without
 *   crashing when Stripe credentials are absent.
 */
export function createStripeWebhookWorkerIfConfigured(
  billingContainer: StripeWebhookWorkerBillingContainer,
): WorkerHandle | null {
  if (!(isStripeConfigured() && isStripeWebhookIngressConfigured())) {
    return null;
  }
  return createStripeWebhookWorker(billingContainer);
}
