import { and, count, desc, isNotNull, isNull, lt } from 'drizzle-orm';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { users } from '@/domains/user/user.schema.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  OFFBOARDING_RECONCILER_SAMPLE_LIMIT,
  OFFBOARDING_STALE_THRESHOLD_MS,
} from './offboarding-reconciler.constants.js';

/**
 * Detects stuck user-offboarding workflows and raises an operator alert (audit-#15).
 *
 * @remarks
 * - **Algorithm:** scans `auth.users` for rows where `deletion_started_at` is older than
 *   {@link OFFBOARDING_STALE_THRESHOLD_MS} while `deleted_at` is still `NULL` — i.e. offboarding
 *   began but never reached the final soft-delete. Reports an exact `count(*)` plus a bounded
 *   sample of public ids. The individual offboarding steps are already idempotent and retryable
 *   from `deletion_started_at`, so an operator can safely re-trigger the delete for an alerted user.
 * - **Failure modes:** Postgres errors propagate to BullMQ retry/DLQ. Read-only — never mutates or
 *   resumes the workflow itself (automatic resumption is a deliberately separate, higher-risk
 *   change because it re-runs external side effects such as S3/Stripe cleanup).
 * - **Side effects:** emits a `warning` Sentry message + structured log when stuck rows exist; an
 *   `info` log otherwise.
 * - **Notes:** runs inside `withGlobalRetentionCleanupDatabaseContext` (no per-tenant RLS) and is
 *   idempotent — re-running with no stuck workflows is a no-op.
 */
export async function runOffboardingReconcilerJob(
  databaseHandle: WorkerDatabaseHandle,
): Promise<{ stuckCount: number }> {
  const cutoff = new Date(Date.now() - OFFBOARDING_STALE_THRESHOLD_MS);
  const stuckCondition = and(
    isNotNull(users.deletion_started_at),
    isNull(users.deleted_at),
    lt(users.deletion_started_at, cutoff),
  );

  const countRows = await databaseHandle
    .select({ value: count() })
    .from(users)
    .where(stuckCondition);
  const stuckCount = countRows[0]?.value ?? 0;

  if (stuckCount === 0) {
    logger.info({ cutoff: cutoff.toISOString() }, 'offboarding-reconciler.no_stuck');
    return { stuckCount: 0 };
  }

  const sampleRows = await databaseHandle
    .select({ public_id: users.public_id, deletion_started_at: users.deletion_started_at })
    .from(users)
    .where(stuckCondition)
    .orderBy(desc(users.deletion_started_at))
    .limit(OFFBOARDING_RECONCILER_SAMPLE_LIMIT);
  const samplePublicIds = sampleRows.map((row) => row.public_id);

  logger.warn(
    { stuckCount, samplePublicIds, cutoff: cutoff.toISOString() },
    'offboarding-reconciler.stuck_detected',
  );
  captureMessage('offboarding-reconciler.stuck_detected', {
    level: 'warning',
    extra: { stuckCount, samplePublicIds, cutoff: cutoff.toISOString() },
  });

  return { stuckCount };
}
