import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processStripeWebhookJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.processor.js';
import { createStripeWebhookWorker } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.worker.js';
import type { StripeWebhookService } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.service.js';
import type Stripe from 'stripe';

const workerProcessorMock = vi.fn();
const workerCloseMock = vi.fn().mockResolvedValue(undefined);
const workerOnMock = vi.fn();

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_queueName: string, processor: typeof workerProcessorMock) {
      workerProcessorMock.mockImplementation(processor);
    }

    on = workerOnMock;

    close = workerCloseMock;
  },
}));

vi.mock('@/infrastructure/queue/connection.js', () => ({
  getBullMQConnectionOptions: () => ({}),
  getBullMQProducerConnectionOptions: () => ({ enableOfflineQueue: false }),
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-options.js', () => ({
  getDefaultWorkerOptions: () => ({}),
}));

vi.mock('@/shared/config/worker-concurrency.util.js', () => ({
  getWorkerConcurrencyStripe: () => 2,
}));

vi.mock('@/infrastructure/queue/worker-runtime/worker-close.util.js', () => ({
  buildWorkerHandle: (worker: { close: () => Promise<void> }, queueName: string) => ({
    worker,
    queueName,
    close: () => worker.close(),
  }),
}));

vi.mock('@/infrastructure/payment/stripe.client.js', () => ({
  retrieveStripeEvent: vi.fn(),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('stripe-webhook.worker', () => {
  const handleEvent = vi.fn().mockResolvedValue(undefined);
  const stripeWebhookService = { handleEvent } as unknown as StripeWebhookService;

  beforeEach(() => {
    handleEvent.mockClear();
    workerProcessorMock.mockClear();
    workerCloseMock.mockClear();
    workerOnMock.mockClear();
  });

  it('processStripeWebhookJob retrieves event from Stripe and delegates to StripeWebhookService', async () => {
    const { retrieveStripeEvent } = await import('@/infrastructure/payment/stripe.client.js');
    const eventPayload = {
      id: 'evt_123',
      type: 'customer.subscription.updated',
      data: { object: {} },
    } as Stripe.Event;
    vi.mocked(retrieveStripeEvent).mockResolvedValue(eventPayload);

    await processStripeWebhookJob(
      {
        stripeEventId: 'evt_123',
        requestId: 'req-1',
      },
      stripeWebhookService,
      'job-1',
    );

    expect(retrieveStripeEvent).toHaveBeenCalledWith('evt_123');
    expect(handleEvent).toHaveBeenCalledOnce();
    expect(handleEvent).toHaveBeenCalledWith(eventPayload, { requestId: 'req-1' });
  });

  it('createStripeWebhookWorker uses injected billing container service', async () => {
    const billingContainer = {
      stripeWebhookService: { handleEvent } as unknown as StripeWebhookService,
    };

    const handle = createStripeWebhookWorker(billingContainer);
    expect(handle.queueName).toBeDefined();

    const { retrieveStripeEvent } = await import('@/infrastructure/payment/stripe.client.js');
    const eventPayload = { id: 'evt_injected', type: 'customer.created', data: { object: {} } };
    vi.mocked(retrieveStripeEvent).mockResolvedValue(eventPayload as Stripe.Event);
    await workerProcessorMock({
      data: {
        stripeEventId: 'evt_injected',
        requestId: 'req-injected',
      },
      id: 'job-injected',
    });

    expect(handleEvent).toHaveBeenCalledOnce();
    await handle.close();
    expect(workerCloseMock).toHaveBeenCalled();
  });
});
