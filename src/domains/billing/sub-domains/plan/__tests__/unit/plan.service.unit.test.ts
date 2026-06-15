import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '@/shared/errors/index.js';
import { PlanService } from '@/domains/billing/sub-domains/plan/plan.service.js';
import type { PlanRepository } from '@/domains/billing/sub-domains/plan/plan.repository.js';

const planRow = {
  id: 1,
  public_id: 'plan_public',
  name: 'Pro',
  description: null,
  price_monthly: '10',
  price_yearly: '100',
  currency: 'USD',
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('PlanService', () => {
  const repository = {
    findByPublicId: vi.fn().mockResolvedValue(planRow),
    findById: vi.fn().mockResolvedValue(planRow),
    findAllActive: vi.fn().mockResolvedValue([planRow]),
  } as unknown as PlanRepository;

  const service = new PlanService(repository);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repository.findByPublicId).mockResolvedValue(planRow as never);
    vi.mocked(repository.findById).mockResolvedValue(planRow as never);
  });

  it('list returns active plans', async () => {
    const plans = await service.list();
    expect(plans).toHaveLength(1);
    expect(plans[0]?.id).toBe('plan_public');
  });

  it('list returns an empty array when no active plans exist', async () => {
    vi.mocked(repository.findAllActive).mockResolvedValue([]);
    await expect(service.list()).resolves.toEqual([]);
  });

  it('list maps nullable description to output', async () => {
    vi.mocked(repository.findAllActive).mockResolvedValue([
      { ...planRow, description: 'Annual plan' },
      { ...planRow, public_id: 'plan_basic', description: null },
    ] as never);

    const plans = await service.list();

    expect(plans[0]?.description).toBe('Annual plan');
    expect(plans[1]?.description).toBeNull();
  });

  it('getByPublicId returns plan output', async () => {
    const plan = await service.getByPublicId('plan_public');
    expect(plan.name).toBe('Pro');
  });

  it('getByPublicId maps null description values', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...planRow,
      description: null,
    } as never);

    const plan = await service.getByPublicId('plan_public');

    expect(plan.description).toBeNull();
  });

  it('requirePlanRecordByPublicId returns the plan row', async () => {
    const row = await service.requirePlanRecordByPublicId('plan_public');
    expect(row.public_id).toBe('plan_public');
  });

  it('requirePlanRecordByPublicId throws when missing', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue(null);
    await expect(service.requirePlanRecordByPublicId('missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('requirePlanRecordByInternalId returns row', async () => {
    const row = await service.requirePlanRecordByInternalId(1);
    expect(row.public_id).toBe('plan_public');
  });

  it('getByPublicId throws when plan is missing', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue(null);
    await expect(service.getByPublicId('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('route-#7: getByPublicId 404s an inactive (retired/draft) plan — public catalog must not leak it', async () => {
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...planRow,
      is_active: false,
    } as never);
    await expect(service.getByPublicId('plan_public')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('route-#7: requirePlanRecordByPublicId still returns an inactive row for internal callers', async () => {
    // The internal resolver must NOT 404 inactive plans (the Stripe webhook needs to map them);
    // only the PUBLIC getByPublicId path hides them.
    vi.mocked(repository.findByPublicId).mockResolvedValue({
      ...planRow,
      is_active: false,
    } as never);
    const row = await service.requirePlanRecordByPublicId('plan_public');
    expect(row.is_active).toBe(false);
  });

  it('requirePlanRecordByInternalId throws when plan is missing', async () => {
    vi.mocked(repository.findById).mockResolvedValue(null);
    await expect(service.requirePlanRecordByInternalId(999)).rejects.toBeInstanceOf(NotFoundError);
  });
});
