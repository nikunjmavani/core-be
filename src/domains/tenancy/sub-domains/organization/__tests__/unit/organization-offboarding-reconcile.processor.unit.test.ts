import { describe, it, expect, vi } from 'vitest';

vi.mock('@/infrastructure/database/contexts/retention-database.context.js', () => ({
  withGlobalRetentionCleanupDatabaseContext: vi.fn(),
}));
vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureException: vi.fn(),
}));

import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { runOrganizationOffboardingReconcileJob } from '@/domains/tenancy/sub-domains/organization/workers/organization-offboarding-reconcile.processor.js';

describe('runOrganizationOffboardingReconcileJob (TEN-06)', () => {
  it('re-drives every stuck offboarding and counts the results', async () => {
    vi.mocked(withGlobalRetentionCleanupDatabaseContext).mockResolvedValue([
      { public_id: 'org_a' },
      { public_id: 'org_b' },
    ] as never);
    const service = { resumeOffboarding: vi.fn().mockResolvedValue(undefined) };

    const result = await runOrganizationOffboardingReconcileJob(service);

    expect(service.resumeOffboarding).toHaveBeenCalledTimes(2);
    expect(service.resumeOffboarding).toHaveBeenCalledWith('org_a');
    expect(result).toEqual({ scanned: 2, resumed: 2, failed: 0 });
  });

  it('counts a per-row failure without aborting the rest of the batch', async () => {
    vi.mocked(withGlobalRetentionCleanupDatabaseContext).mockResolvedValue([
      { public_id: 'org_a' },
      { public_id: 'org_b' },
    ] as never);
    const service = {
      resumeOffboarding: vi
        .fn()
        .mockRejectedValueOnce(new Error('stripe down'))
        .mockResolvedValueOnce(undefined),
    };

    const result = await runOrganizationOffboardingReconcileJob(service);

    expect(result).toEqual({ scanned: 2, resumed: 1, failed: 1 });
  });

  it('no-ops when nothing is stuck', async () => {
    vi.mocked(withGlobalRetentionCleanupDatabaseContext).mockResolvedValue([] as never);
    const service = { resumeOffboarding: vi.fn() };

    const result = await runOrganizationOffboardingReconcileJob(service);

    expect(service.resumeOffboarding).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, resumed: 0, failed: 0 });
  });
});
