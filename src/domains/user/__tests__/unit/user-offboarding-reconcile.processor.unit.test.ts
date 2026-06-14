import { describe, it, expect, vi } from 'vitest';

vi.mock('@/infrastructure/database/contexts/retention-database.context.js', () => ({
  withGlobalRetentionCleanupDatabaseContext: vi.fn(),
}));
vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureException: vi.fn(),
}));

import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { runUserOffboardingReconcileJob } from '@/domains/user/workers/user-offboarding-reconcile.processor.js';

describe('runUserOffboardingReconcileJob (USER-04/USER-09)', () => {
  it('re-drives every stuck offboarding and counts the results', async () => {
    vi.mocked(withGlobalRetentionCleanupDatabaseContext).mockResolvedValue([
      { public_id: 'user_a' },
      { public_id: 'user_b' },
    ] as never);
    const service = { resumeOffboarding: vi.fn().mockResolvedValue(undefined) };

    const result = await runUserOffboardingReconcileJob(service);

    expect(service.resumeOffboarding).toHaveBeenCalledTimes(2);
    expect(service.resumeOffboarding).toHaveBeenCalledWith('user_a');
    expect(service.resumeOffboarding).toHaveBeenCalledWith('user_b');
    expect(result).toEqual({ scanned: 2, resumed: 2, failed: 0 });
  });

  it('counts a per-row failure without aborting the rest of the batch', async () => {
    vi.mocked(withGlobalRetentionCleanupDatabaseContext).mockResolvedValue([
      { public_id: 'user_a' },
      { public_id: 'user_b' },
    ] as never);
    const service = {
      resumeOffboarding: vi
        .fn()
        .mockRejectedValueOnce(new Error('stripe down'))
        .mockResolvedValueOnce(undefined),
    };

    const result = await runUserOffboardingReconcileJob(service);

    expect(service.resumeOffboarding).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ scanned: 2, resumed: 1, failed: 1 });
  });

  it('no-ops when nothing is stuck', async () => {
    vi.mocked(withGlobalRetentionCleanupDatabaseContext).mockResolvedValue([] as never);
    const service = { resumeOffboarding: vi.fn() };

    const result = await runUserOffboardingReconcileJob(service);

    expect(service.resumeOffboarding).not.toHaveBeenCalled();
    expect(result).toEqual({ scanned: 0, resumed: 0, failed: 0 });
  });
});
