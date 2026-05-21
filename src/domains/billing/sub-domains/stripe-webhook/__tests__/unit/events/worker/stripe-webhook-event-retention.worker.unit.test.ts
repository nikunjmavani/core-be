import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runStripeWebhookEventRetentionJob } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook-event-retention.processor.js';

const deleteInBatchesByConditionMock = vi.fn();

vi.mock('@/infrastructure/database/batch-delete.util.js', () => ({
  deleteInBatchesByCondition: (...arguments_: unknown[]) =>
    deleteInBatchesByConditionMock(...arguments_),
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: { STRIPE_WEBHOOK_EVENT_RETENTION_DAYS: 90, LOG_LEVEL: 'silent' },
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('stripe-webhook-event-retention.worker', () => {
  beforeEach(() => {
    deleteInBatchesByConditionMock.mockReset();
    deleteInBatchesByConditionMock.mockResolvedValue({ deletedCount: 10, blockedCount: 0 });
  });

  it('runStripeWebhookEventRetentionJob purges terminal ledger rows older than retention window', async () => {
    const result = await runStripeWebhookEventRetentionJob({} as never);

    expect(deleteInBatchesByConditionMock).toHaveBeenCalledOnce();
    expect(deleteInBatchesByConditionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logContext: 'stripe-webhook-event-retention',
        tableLabel: 'billing.stripe_webhook_events',
      }),
    );
    expect(result).toEqual({ deletedCount: 10, blockedCount: 0 });
  });
});
