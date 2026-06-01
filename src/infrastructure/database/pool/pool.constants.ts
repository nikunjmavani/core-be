/**
 * Default postgres.js pool size per Node process when `DATABASE_POOL_MAX` is unset.
 *
 * Single source of truth: both the live pool (`buildPostgresOptions` in `connection.ts`) and the
 * pool-exhaustion alerter (`evaluatePoolExhaustionAndAlert`) resolve their max from this constant,
 * so the saturation thresholds can never silently drift from the connections actually available.
 * Kept in a dependency-free module so the alerter does not transitively instantiate the pg pool.
 */
export const DEFAULT_DATABASE_POOL_MAX = 10;
