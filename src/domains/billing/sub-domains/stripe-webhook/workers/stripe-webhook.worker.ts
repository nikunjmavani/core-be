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
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { processStripeWebhookJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.processor.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

export type StripeWebhookWorkerBillingContainer = Pick<BillingContainer, 'stripeWebhookService'>;

/**
 * BullMQ worker that processes verified Stripe webhook events asynchronously.
 * Requires billing services from the shared worker composition root (`createWorkerContainers`).
 */
export function createStripeWebhookWorker(
  billingContainer: StripeWebhookWorkerBillingContainer,
): WorkerHandle {
  const { stripeWebhookService } = billingContainer;
  const worker = new Worker<StripeWebhookJobData>(
    STRIPE_WEBHOOK_QUEUE_NAME,
    async (job) => {
      await processStripeWebhookJob(job.data, stripeWebhookService, job.id);
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

export function createStripeWebhookWorkerIfConfigured(
  billingContainer: StripeWebhookWorkerBillingContainer,
): WorkerHandle | null {
  if (!(isStripeConfigured() && isStripeWebhookIngressConfigured())) {
    return null;
  }
  return createStripeWebhookWorker(billingContainer);
}
