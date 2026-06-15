/**
 * Pure configuration parsing for the settle-check runner (`settle-check.ts`).
 * Kept free of infrastructure imports and side effects so the env-override and
 * queue-override branches are unit-testable in isolation; the runner reads
 * `process.env` and the default queue list and passes them in.
 */

/**
 * Parses a positive integer from an env value, falling back when the value is
 * absent, non-numeric, zero, or negative. Used for the timeout and poll-interval
 * knobs so a malformed override can never produce a non-positive loop bound.
 */
export function parsePositiveIntegerEnv(rawValue: string | undefined, fallback: number): number {
  if (rawValue === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolves the queues to watch from the `SETTLE_CHECK_QUEUES` override (a
 * comma-separated list) or the supplied defaults. Trims and drops blank entries;
 * an absent, blank, or all-blank override falls back to `defaults` so the check
 * never runs against an empty queue set (which would pass vacuously).
 */
export function resolveQueueNames(
  override: string | undefined,
  defaults: readonly string[],
): string[] {
  if (override === undefined || override.trim() === '') {
    return [...defaults];
  }
  const names = override
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 ? names : [...defaults];
}
