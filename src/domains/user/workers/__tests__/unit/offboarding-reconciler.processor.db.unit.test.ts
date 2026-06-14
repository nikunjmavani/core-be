import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// audit-#15: spy captureMessage (keep other sentry exports real) so the stuck-offboarding alert
// can be asserted.
vi.mock('@/infrastructure/observability/sentry/sentry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/infrastructure/observability/sentry/sentry.js')>()),
  captureMessage: vi.fn(),
}));

import { cleanupDatabase, database } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { users } from '@/domains/user/user.schema.js';
import { withGlobalRetentionCleanupDatabaseContext } from '@/infrastructure/database/contexts/retention-database.context.js';
import { runOffboardingReconcilerJob } from '@/domains/user/workers/offboarding-reconciler.processor.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';

/**
 * audit-#15: a scheduled reconciler must surface offboarding workflows that stamped
 * `deletion_started_at` but never completed (deleted_at still NULL), so a partially-applied
 * destructive deletion is not silently stuck forever with no operator signal.
 */
describe('runOffboardingReconcilerJob (database — audit-#15)', () => {
  const TWO_HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const FIVE_MIN_AGO = new Date(Date.now() - 5 * 60 * 1000);

  beforeEach(async () => {
    await cleanupDatabase();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects + alerts on a stuck offboarding (old deletion_started_at, not yet deleted)', async () => {
    const stuck = await createTestUser({ email: 'stuck-offboarding@example.com' });
    await database
      .update(users)
      .set({ deletion_started_at: TWO_HOURS_AGO })
      .where(eq(users.id, stuck.id));

    // Healthy rows that must NOT be flagged:
    const completed = await createTestUser({ email: 'completed-offboarding@example.com' });
    await database
      .update(users)
      .set({ deletion_started_at: TWO_HOURS_AGO, deleted_at: new Date() })
      .where(eq(users.id, completed.id));
    const recentlyStarted = await createTestUser({ email: 'recent-offboarding@example.com' });
    await database
      .update(users)
      .set({ deletion_started_at: FIVE_MIN_AGO })
      .where(eq(users.id, recentlyStarted.id));
    await createTestUser({ email: 'normal-user@example.com' });

    const result = await withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
      runOffboardingReconcilerJob(databaseHandle),
    );

    expect(result.stuckCount).toBe(1);
    expect(vi.mocked(captureMessage)).toHaveBeenCalledWith(
      'offboarding-reconciler.stuck_detected',
      expect.objectContaining({
        level: 'warning',
        extra: expect.objectContaining({
          stuckCount: 1,
          samplePublicIds: expect.arrayContaining([stuck.public_id]),
        }),
      }),
    );
  });

  it('is a no-op (no alert) when there are no stuck workflows', async () => {
    await createTestUser({ email: 'healthy@example.com' });

    const result = await withGlobalRetentionCleanupDatabaseContext((databaseHandle) =>
      runOffboardingReconcilerJob(databaseHandle),
    );

    expect(result.stuckCount).toBe(0);
    expect(vi.mocked(captureMessage)).not.toHaveBeenCalled();
  });
});
