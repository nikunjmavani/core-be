/**
 * Default postgres.js pool size per Node process when `DATABASE_POOL_MAX` is unset.
 *
 * Single source of truth: both the live pool (`buildPostgresOptions` in `connection.ts`) and the
 * pool-exhaustion alerter (`evaluatePoolExhaustionAndAlert`) resolve their max from this constant,
 * so the saturation thresholds can never silently drift from the connections actually available.
 * Kept in a dependency-free module so the alerter does not transitively instantiate the pg pool.
 */
export const DEFAULT_DATABASE_POOL_MAX = 10;

/** Default seconds an idle pooled connection is kept before postgres.js closes it (`idle_timeout`). */
export const DEFAULT_DATABASE_POOL_IDLE_TIMEOUT_SECONDS = 300;

/** Default seconds to wait for a new connection before failing (`connect_timeout`). */
export const DEFAULT_DATABASE_POOL_CONNECT_TIMEOUT_SECONDS = 10;

/** Default max lifetime (seconds) of a pooled connection before recycling (`max_lifetime`, 30 min). */
export const DEFAULT_DATABASE_POOL_MAX_LIFETIME_SECONDS = 1_800;
