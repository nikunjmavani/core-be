import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';

const mockReturning = vi.fn();
const mockWhere = vi.fn(() => ({ returning: mockReturning }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  getRequestDatabase: () => ({
    update: mockUpdate,
  }),
}));

describe('SubscriptionRepository.syncFromStripeProviderSubscription monotonic guard', () => {
  const repository = new SubscriptionRepository();

  beforeEach(() => {
    mockUpdate.mockClear();
    mockSet.mockClear();
    mockWhere.mockClear();
    mockReturning.mockReset();
  });

  it('passes stripe_event_created_at into the update set payload', async () => {
    const stripeEventCreatedAt = new Date('2026-03-01T00:00:00.000Z');
    mockReturning.mockResolvedValue([{ id: 1, status: 'PAST_DUE' }]);

    await repository.syncFromStripeProviderSubscription(
      'sub_123',
      { status: 'PAST_DUE' },
      stripeEventCreatedAt,
    );

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PAST_DUE',
        last_stripe_event_created_at: stripeEventCreatedAt,
      }),
    );
    expect(mockWhere).toHaveBeenCalled();
  });

  it('returns null when monotonic guard prevents an update', async () => {
    mockReturning.mockResolvedValue([]);

    const result = await repository.syncFromStripeProviderSubscription(
      'sub_123',
      { status: 'ACTIVE' },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(result).toBeNull();
  });
});
