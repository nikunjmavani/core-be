import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { DLQ_AUTO_RETRY_STATE_TTL_SECONDS } from '@/infrastructure/queue/dlq/dlq-auto-retry.constants.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const DLQ_AUTO_RETRY_KEY_PREFIX = 'dlq-auto-retry:';

/**
 * Redis-backed auto-retry counter for one `audit.dead_letter_jobs` row.
 *
 * @remarks
 * - **Algorithm:** append-only ledger rows stay immutable; retry budget lives in Redis.
 * - **Failure modes:** parse errors return `null` (treated as no prior auto retries).
 * - **Side effects:** none from this type alone.
 * - **Notes:** keyed by Postgres `dead_letter_jobs.id`.
 */
export type DlqAutoRetryState = {
  count: number;
  lastAttemptAt: string;
};

function buildKey(deadLetterJobId: number): string {
  return `${DLQ_AUTO_RETRY_KEY_PREFIX}${deadLetterJobId}`;
}

function parseState(raw: string): DlqAutoRetryState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DlqAutoRetryState>;
    if (typeof parsed.count !== 'number' || typeof parsed.lastAttemptAt !== 'string') {
      return null;
    }
    return { count: parsed.count, lastAttemptAt: parsed.lastAttemptAt };
  } catch (error) {
    logger.warn({ error, raw }, 'dlq-auto-retry.state.parse_failed');
    return null;
  }
}

/**
 * Loads the auto-retry counter for a dead-letter ledger row.
 *
 * @remarks
 * - **Algorithm:** single Redis `GET`; missing key → `null`.
 * - **Failure modes:** Redis errors log at warn and return `null` (skip retry for safety).
 * - **Side effects:** read-only.
 * - **Notes:** `null` means no prior automated replay attempts.
 */
export async function getDlqAutoRetryState(
  deadLetterJobId: number,
): Promise<DlqAutoRetryState | null> {
  try {
    const raw = await redisConnection.get(buildKey(deadLetterJobId));
    if (!raw) return null;
    return parseState(raw);
  } catch (error) {
    logger.warn({ error, deadLetterJobId }, 'dlq-auto-retry.state.get_failed');
    return null;
  }
}

/**
 * Returns whether another automated replay is allowed for this ledger row.
 *
 * @remarks
 * - **Algorithm:** compares Redis counter to `maxCount` and enforces cooldown since
 *   `lastAttemptAt` (or `failedAt` when never auto-retried).
 * - **Failure modes:** when state is unreadable, treats count as zero but still applies
 *   the initial failure-age cooldown via `failedAt`.
 * - **Side effects:** none.
 * - **Notes:** caller must still verify circuit state and payload reconstructability.
 */
export function isDeadLetterJobEligibleForAutoRetry(input: {
  state: DlqAutoRetryState | null;
  failedAt: Date;
  maxCount: number;
  cooldownMs: number;
  nowMs?: number;
}): boolean {
  const nowMs = input.nowMs ?? Date.now();
  const attemptCount = input.state?.count ?? 0;
  if (attemptCount >= input.maxCount) return false;

  const lastAttemptMs = input.state
    ? new Date(input.state.lastAttemptAt).getTime()
    : input.failedAt.getTime();
  return nowMs - lastAttemptMs >= input.cooldownMs;
}

/**
 * Increments the auto-retry counter after a successful automated replay.
 *
 * @remarks
 * - **Algorithm:** read-modify-write with refreshed TTL.
 * - **Failure modes:** Redis errors propagate to the caller (replay already succeeded).
 * - **Side effects:** writes one Redis string key.
 * - **Notes:** count includes this attempt.
 */
export async function recordDlqAutoRetryAttempt(
  deadLetterJobId: number,
): Promise<DlqAutoRetryState> {
  const existing = await getDlqAutoRetryState(deadLetterJobId);
  const next: DlqAutoRetryState = {
    count: (existing?.count ?? 0) + 1,
    lastAttemptAt: new Date().toISOString(),
  };
  await redisConnection.set(
    buildKey(deadLetterJobId),
    JSON.stringify(next),
    'EX',
    DLQ_AUTO_RETRY_STATE_TTL_SECONDS,
  );
  return next;
}

/** Test helper — clears auto-retry state for one ledger row. */
export async function resetDlqAutoRetryStateForTests(deadLetterJobId: number): Promise<void> {
  await redisConnection.del(buildKey(deadLetterJobId));
}
