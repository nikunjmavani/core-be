import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { WEBHOOK_DELIVERY_QUEUE_NAME } from '@/domains/notify/sub-domains/webhook/queues/webhook-delivery.queue.js';
import { NOTIFICATION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';

type WorkerInstallation = {
  queueName: string;
  concurrency: number;
};

const workerInstallations: WorkerInstallation[] = [];

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(queueName: string, _processor: unknown, options: { concurrency?: number }) {
      workerInstallations.push({
        queueName,
        concurrency: options.concurrency ?? 1,
      });
    }

    on() {
      return this;
    }

    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQConnectionOptions: () => ({}),
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-options.js', () => ({
  getDefaultWorkerOptions: () => ({}),
  getWebhookWorkerOptions: () => ({}),
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-close.util.js', () => ({
  buildWorkerHandle: (worker: { close: () => Promise<void> }, queueName: string) => ({
    worker,
    queueName,
    close: () => worker.close(),
  }),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/shared/config/worker-concurrency.util.js', () => ({
  getWorkerConcurrencyMail: () => 2,
  getWorkerConcurrencyNotify: () => 6,
  getWorkerConcurrencyWebhook: () => 10,
  getWorkerConcurrencyStripe: () => 3,
}));

vi.mock('@/domains/notify/sub-domains/webhook/workers/webhook-outbound-circuit.js', () => ({
  fetchWebhookWithCircuitBreaker: vi.fn(),
  webhookDeliveryBackoffWithJitter: () => 1000,
}));

vi.mock('@/domains/notify/sub-domains/webhook/webhook-delivery.repository.js', () => ({
  findWebhookDeliveryAttemptWithWebhook: vi.fn(),
}));

vi.mock('@/infrastructure/payment/stripe.client.js', () => ({
  retrieveStripeEvent: vi.fn(),
}));

/**
 * Throughput queue families use separate BullMQ Worker instances with independent
 * `WORKER_CONCURRENCY_*` bulkheads so a mail burst cannot consume webhook slots.
 *
 * Optional k6 burst validation: `src/tests/load/k6/` (run against staging with Redis).
 */
describe('Performance: worker concurrency bulkheads', () => {
  beforeEach(() => {
    workerInstallations.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers mail and webhook-delivery on separate queues with independent concurrency', async () => {
    const { createMailWorker } = await import('@/infrastructure/mail/workers/mail.worker.js');
    const { createWebhookDeliveryWorker } = await import(
      '@/domains/notify/sub-domains/webhook/workers/webhook-delivery.worker.js'
    );

    const mailHandle = createMailWorker();
    const webhookHandle = createWebhookDeliveryWorker();

    const mailInstallation = workerInstallations.find((w) => w.queueName === MAIL_QUEUE_NAME);
    const webhookInstallation = workerInstallations.find(
      (w) => w.queueName === WEBHOOK_DELIVERY_QUEUE_NAME,
    );

    expect(mailInstallation).toEqual({ queueName: MAIL_QUEUE_NAME, concurrency: 2 });
    expect(webhookInstallation).toEqual({
      queueName: WEBHOOK_DELIVERY_QUEUE_NAME,
      concurrency: 10,
    });
    expect(mailInstallation?.concurrency).not.toBe(webhookInstallation?.concurrency);

    await mailHandle.close();
    await webhookHandle.close();
  });

  it('notification and stripe webhook workers use their own bulkhead concurrency', async () => {
    const { createNotificationWorker } = await import(
      '@/domains/notify/sub-domains/notification/workers/notification.worker.js'
    );
    const { createStripeWebhookWorker } = await import(
      '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.worker.js'
    );

    const notificationHandle = createNotificationWorker();
    const stripeHandle = createStripeWebhookWorker({
      stripeWebhookService: { handleEvent: vi.fn() },
    } as never);

    const notificationInstallation = workerInstallations.find(
      (w) => w.queueName === NOTIFICATION_QUEUE_NAME,
    );
    const stripeInstallation = workerInstallations.find(
      (w) => w.queueName === STRIPE_WEBHOOK_QUEUE_NAME,
    );

    expect(notificationInstallation).toEqual({
      queueName: NOTIFICATION_QUEUE_NAME,
      concurrency: 6,
    });
    expect(stripeInstallation).toEqual({
      queueName: STRIPE_WEBHOOK_QUEUE_NAME,
      concurrency: 3,
    });

    await notificationHandle.close();
    await stripeHandle.close();
  });
});
