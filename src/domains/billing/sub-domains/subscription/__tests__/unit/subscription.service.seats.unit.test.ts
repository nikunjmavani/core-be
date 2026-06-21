import { describe, it, expect, vi, beforeEach } from 'vitest';

// REQ-4: stub the seat-sync producer queue so syncs never open Redis in unit tests.
const seatSyncMocks = vi.hoisted(() => ({ enqueueSubscriptionSeatSyncBestEffort: vi.fn() }));
vi.mock(
  '@/domains/billing/sub-domains/subscription/queues/subscription-seat-sync.queue.js',
  () => seatSyncMocks,
);

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

import { SubscriptionService } from '@/domains/billing/sub-domains/subscription/subscription.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { PlanService } from '@/domains/billing/sub-domains/plan/plan.service.js';
import type { SubscriptionRepository } from '@/domains/billing/sub-domains/subscription/subscription.repository.js';
import type { PaymentProvider } from '@/domains/billing/sub-domains/subscription/payment-provider.port.js';
import type { MembershipSeatUsagePort } from '@/domains/billing/sub-domains/subscription/subscription.service.js';

const organization = { id: 1, public_id: 'org_public', name: 'Org', slug: 'org' };

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    public_id: 'sub_public',
    organization_id: 1,
    status: 'ACTIVE',
    billing_cycle: 'MONTHLY',
    seats: null,
    plan_public_id: 'pln_public',
    plan_included_seats: 10,
    provider: 'stripe',
    provider_subscription_id: 'sub_x',
    current_period_start: new Date('2026-05-01'),
    current_period_end: new Date('2026-06-01'),
    trial_end: null,
    cancel_at_period_end: false,
    canceled_at: null,
    created_at: new Date('2026-05-01'),
    updated_at: new Date('2026-05-01'),
    ...overrides,
  };
}

describe('SubscriptionService seat counters (REQ-4)', () => {
  const organizationService = {
    requireOrganizationByPublicId: vi.fn().mockResolvedValue(organization),
  } as unknown as OrganizationService;
  const planService = {} as unknown as PlanService;
  const paymentProvider = {
    updateSubscriptionQuantity: vi.fn().mockResolvedValue(undefined),
  } as unknown as PaymentProvider;
  const repository = {
    listByOrganization: vi.fn(),
    findByPublicId: vi.fn(),
    findActiveByOrganization: vi.fn(),
    findActiveSeatStateByOrganizationForUpdate: vi.fn(),
    update: vi.fn().mockResolvedValue(baseRow()),
  } as unknown as SubscriptionRepository;
  const membershipSeatUsage: MembershipSeatUsagePort = {
    countActiveMembers: vi.fn().mockResolvedValue(3),
  };

  const service = new SubscriptionService(
    organizationService,
    planService,
    repository,
    paymentProvider,
    membershipSeatUsage,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationService.requireOrganizationByPublicId).mockResolvedValue(
      organization as never,
    );
    vi.mocked(membershipSeatUsage.countActiveMembers).mockResolvedValue(3);
  });

  it('list() decorates rows with seats_total (subscription.seats ?? plan.included_seats) and seats_used', async () => {
    vi.mocked(repository.listByOrganization).mockResolvedValue([
      baseRow({ seats: null, plan_included_seats: 10 }),
      baseRow({ public_id: 'sub_2', seats: 50, plan_included_seats: 10 }),
    ] as never);

    const rows = await service.list('org_public');

    // First row: no purchased seats → falls back to plan.included_seats.
    expect(rows[0]!.seats_total).toBe(10);
    // Second row: purchased seats win over the plan fallback.
    expect(rows[1]!.seats_total).toBe(50);
    // seats_used is the org membership count, shared across rows; resolved once.
    expect(rows[0]!.seats_used).toBe(3);
    expect(rows[1]!.seats_used).toBe(3);
    expect(membershipSeatUsage.countActiveMembers).toHaveBeenCalledTimes(1);
  });

  it('get() seats_total is null when both subscription.seats and plan.included_seats are null (unlimited)', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue(
      baseRow({ seats: null, plan_included_seats: null }) as never,
    );
    const row = await service.get('org_public', 'sub_public');
    expect(row.seats_total).toBeNull();
    expect(row.seats_used).toBe(3);
  });

  it('reserveSeatCeilingForMemberAdd returns null when the org has no active subscription (no ceiling)', async () => {
    vi.mocked(repository.findActiveSeatStateByOrganizationForUpdate).mockResolvedValue(null);
    await expect(service.reserveSeatCeilingForMemberAdd(1)).resolves.toBeNull();
  });

  it('reserveSeatCeilingForMemberAdd prefers purchased seats, else plan included_seats', async () => {
    vi.mocked(repository.findActiveSeatStateByOrganizationForUpdate).mockResolvedValueOnce({
      seats: 7,
      plan_included_seats: 3,
    });
    await expect(service.reserveSeatCeilingForMemberAdd(1)).resolves.toBe(7);

    vi.mocked(repository.findActiveSeatStateByOrganizationForUpdate).mockResolvedValueOnce({
      seats: null,
      plan_included_seats: 3,
    });
    await expect(service.reserveSeatCeilingForMemberAdd(1)).resolves.toBe(3);
  });

  it('syncSeatQuantityForOrganization pushes max(1, memberCount) to Stripe with a quantity-scoped idempotency key (audit #1)', async () => {
    vi.mocked(repository.findActiveByOrganization).mockResolvedValue(baseRow() as never);
    vi.mocked(membershipSeatUsage.countActiveMembers).mockResolvedValue(4);

    await service.syncSeatQuantityForOrganization('org_public', 'idem-1');

    // The Stripe key is the stable base token scoped by the resolved quantity, so a retry of the
    // SAME job (same quantity) reuses ONE key (Stripe dedups → no duplicate proration).
    expect(paymentProvider.updateSubscriptionQuantity).toHaveBeenCalledWith(
      'sub_x',
      4,
      'idem-1:qty:4',
    );
    expect(repository.update).toHaveBeenCalledWith('sub_public', 1, { seats: 4 });
  });

  it('syncSeatQuantityForOrganization derives a DIFFERENT key when the recomputed quantity changes (no Stripe param-mismatch on retry)', async () => {
    vi.mocked(repository.findActiveByOrganization).mockResolvedValue(baseRow() as never);

    vi.mocked(membershipSeatUsage.countActiveMembers).mockResolvedValue(6);
    await service.syncSeatQuantityForOrganization('org_public', 'tok-A');
    vi.mocked(membershipSeatUsage.countActiveMembers).mockResolvedValue(5);
    await service.syncSeatQuantityForOrganization('org_public', 'tok-A');

    expect(paymentProvider.updateSubscriptionQuantity).toHaveBeenNthCalledWith(
      1,
      'sub_x',
      6,
      'tok-A:qty:6',
    );
    expect(paymentProvider.updateSubscriptionQuantity).toHaveBeenNthCalledWith(
      2,
      'sub_x',
      5,
      'tok-A:qty:5',
    );
  });

  it('enqueueSeatQuantitySync stamps a stable per-enqueue token when the hot path passes none (audit #1)', () => {
    service.enqueueSeatQuantitySync('org_public');
    const call = vi.mocked(seatSyncMocks.enqueueSubscriptionSeatSyncBestEffort).mock
      .calls[0]![0] as {
      idempotencyKey?: string;
    };
    expect(call.idempotencyKey).toMatch(/^seat-sync:org_public:/);
  });

  it('enqueueSeatQuantitySync forwards an explicit caller key unchanged (changePlan path)', () => {
    service.enqueueSeatQuantitySync('org_public', 'client-key-123');
    const call = vi.mocked(seatSyncMocks.enqueueSubscriptionSeatSyncBestEffort).mock
      .calls[0]![0] as {
      idempotencyKey?: string;
    };
    expect(call.idempotencyKey).toBe('client-key-123');
  });

  it('syncSeatQuantityForOrganization is a no-op when there is no active subscription', async () => {
    vi.mocked(repository.findActiveByOrganization).mockResolvedValue(null);
    await service.syncSeatQuantityForOrganization('org_public');
    expect(paymentProvider.updateSubscriptionQuantity).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });
});
