import type { Redis } from 'ioredis';

/**
 * Lua: `INCR` a key and set its TTL only on the first increment, atomically — so nothing can land
 * between the increment and the expire.
 */
const INCREMENT_WITH_EXPIRY_ON_FIRST_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

/**
 * Atomically increments `key` and, on the first increment only, sets its `ttlSeconds` expiry.
 *
 * @remarks
 * - **Algorithm:** one Lua script runs `INCR` then a conditional `EXPIRE`, so a process crash can
 *   never land in the gap between them and leave a counter with no TTL — the foot-gun of the
 *   separate `INCR` + `if (count === 1) EXPIRE` pattern (route-audit C5).
 * - **Returns:** the post-increment count.
 * - **Notes:** for fixed-window counters (failed-login / MFA-lockout); the window is anchored to the
 *   first increment and not extended by later ones.
 */
export async function incrementWithExpiryOnFirst(
  redis: Redis,
  key: string,
  ttlSeconds: number,
): Promise<number> {
  const result = await redis.eval(INCREMENT_WITH_EXPIRY_ON_FIRST_LUA, 1, key, String(ttlSeconds));
  return typeof result === 'number' ? result : Number(result);
}
