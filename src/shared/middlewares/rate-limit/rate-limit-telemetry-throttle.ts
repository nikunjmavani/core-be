/**
 * Per-key throttle for rate-limit `onExceeding` telemetry (the global + per-route observers).
 *
 * @remarks
 * - **Algorithm:** keeps a bounded `Map<key, lastEmittedAtMs>`; returns `true` at most once per
 *   {@link RATE_LIMIT_TELEMETRY_THROTTLE_MS} per key. When the map reaches
 *   {@link RATE_LIMIT_TELEMETRY_MAX_TRACKED_KEYS} it is cleared wholesale (cheap, bounded memory)
 *   rather than evicted LRU — telemetry sampling tolerates the occasional reset.
 * - **Why:** `onExceeding` fires on every throttle-adjacent request. Under concentrated load (a
 *   single egress IP / shared NAT, or one hot per-user bucket) the prior unthrottled observers
 *   emitted a Pino WARN **and** a Sentry breadcrumb per request — a load test showed ~3.6k WARN
 *   lines in 22s for requests that still returned 200, burning CPU + log volume exactly when the
 *   process is hottest. Throttling preserves the security signal (you still see the bucket key
 *   being hit) without the per-request flood.
 * - **Side effects:** mutates the module-level map. Process-local (not cluster-wide); each replica
 *   throttles independently, which is the desired behavior for log/breadcrumb volume control.
 */
const RATE_LIMIT_TELEMETRY_THROTTLE_MS = 10_000;
const RATE_LIMIT_TELEMETRY_MAX_TRACKED_KEYS = 10_000;
const rateLimitTelemetryLastEmittedAtMsByKey = new Map<string, number>();

/**
 * Returns `true` when rate-limit telemetry for `key` should be emitted now, applying the per-key
 * time throttle described in the module remarks. See module-level `@remarks` for the algorithm.
 */
export function shouldEmitRateLimitTelemetry(key: string): boolean {
  const nowMs = Date.now();
  const lastEmittedAtMs = rateLimitTelemetryLastEmittedAtMsByKey.get(key);
  if (lastEmittedAtMs !== undefined && nowMs - lastEmittedAtMs < RATE_LIMIT_TELEMETRY_THROTTLE_MS) {
    return false;
  }
  if (rateLimitTelemetryLastEmittedAtMsByKey.size >= RATE_LIMIT_TELEMETRY_MAX_TRACKED_KEYS) {
    rateLimitTelemetryLastEmittedAtMsByKey.clear();
  }
  rateLimitTelemetryLastEmittedAtMsByKey.set(key, nowMs);
  return true;
}
