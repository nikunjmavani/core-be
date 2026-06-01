import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runStripeWebhookEventReclaimJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-reclaim.processor.js';

const sweepReclaimableEventsMock = vi.fn();
const countFailedEventsMock = vi.fn();
const enqueueStripeWebhookByEventIdMock = vi.fn();
const setStripeWebhookEventsFailedCountMock = vi.fn();

vi.mock('@/infrastructure/database/contexts/worker-database.context.js', () => ({
  withSystemTableWorkerContext: (callback: () => Promise<unknown>) => callback(),
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js', () => ({
  StripeWebhookEventRepository: class MockStripeWebhookEventRepository {
    sweepReclaimableEvents = sweepReclaimableEventsMock;
    countFailedEvents = countFailedEventsMock;
  },
}));

vi.mock('@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js', () => ({
  enqueueStripeWebhookByEventId: (...arguments_: unknown[]) =>
    enqueueStripeWebhookByEventIdMock(...arguments_),
}));

vi.mock('@/infrastructure/observability/metrics/prometheus-metrics.js', () => ({
  setStripeWebhookEventsFailedCount: (...arguments_: unknown[]) =>
    setStripeWebhookEventsFailedCountMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { STRIPE_WEBHOOK_EVENT_RECLAIM_BATCH_SIZE: 50, LOG_LEVEL: 'silent' },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('stripe-webhook-event-reclaim.worker', () => {
  beforeEach(() => {
    sweepReclaimableEventsMock.mockReset();
    countFailedEventsMock.mockReset();
    enqueueStripeWebhookByEventIdMock.mockReset();
    setStripeWebhookEventsFailedCountMock.mockReset();
    sweepReclaimableEventsMock.mockResolvedValue({
      scannedCount: 2,
      reclaimedCount: 1,
      reclaimedStripeEventIds: ['evt_reclaim_1'],
    });
    countFailedEventsMock.mockResolvedValue(0);
    enqueueStripeWebhookByEventIdMock.mockResolvedValue(undefined);
  });

  it('runStripeWebhookEventReclaimJob reclaims rows and enqueues stripe-webhook jobs', async () => {
    const result = await runStripeWebhookEventReclaimJob();

    expect(sweepReclaimableEventsMock).toHaveBeenCalledWith(50);
    expect(enqueueStripeWebhookByEventIdMock).toHaveBeenCalledWith(
      'evt_reclaim_1',
      'stripe-webhook-event-reclaim',
    );
    expect(setStripeWebhookEventsFailedCountMock).toHaveBeenCalledWith(0);
    expect(result).toEqual({ scannedCount: 2, reclaimedCount: 1, enqueuedCount: 1 });
  });
});
