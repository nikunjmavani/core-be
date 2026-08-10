import type { Redis } from 'ioredis';
import { type MockInstance, vi } from 'vitest';

/**
 * Variadic view of a mocked `Redis['set']` — every argument position readable, `null` resolvable.
 */
export type MockedRedisSet = MockInstance<(...args: unknown[]) => Promise<'OK' | null>>;

/**
 * Wraps `vi.mocked(redis.set)` in a variadic signature so option-form `SET` calls stay assertable.
 *
 * @remarks
 * **Why:** `Redis['set']` is a large overload set and TypeScript resolves `vi.mocked` against the
 * *last* overload. ioredis 6 reordered them, making that last overload the narrow
 * `(key, value, callback?) => 'OK'`. Two consequences, both purely at the type level:
 * `mockResolvedValue(null)` is rejected even though `SET … NX` genuinely returns `null` under
 * contention, and `mock.calls[0][2..4]` (the `EX` / ttl / `NX` positions) are reported as
 * out-of-bounds on a 3-tuple.
 *
 * **Notes:** runtime behaviour is identical on ioredis 5 and 6 — production callers such as
 * `withRedisLock` still bind the precise `(key, value, 'EX', ttl, 'NX')` overload and typecheck
 * unaided. This helper exists only so assertions can see the arguments the call actually made.
 */
export function mockedRedisSet(set: Redis['set']): MockedRedisSet {
  return vi.mocked(set) as unknown as MockedRedisSet;
}
