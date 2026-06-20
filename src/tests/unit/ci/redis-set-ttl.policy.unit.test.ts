import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * EX-30: every Redis string write must set an expiry so a forgotten TTL cannot grow the keyspace
 * unbounded. This scans `src/**\/*.ts` (excluding tests) for Redis client `.set(` / `.setex(` calls
 * and asserts each carries a TTL flag (`EX`/`PX`/`EXAT`/`PXAT`) or `KEEPTTL`, with a small allowlist
 * for keys that are intentionally persistent (rewritten in place, not cached).
 */
const SRC_ROOT = join(process.cwd(), 'src');

/** Redis SET on the shared connection or a `redis` / `this.redis` alias (not Map/gauge/header .set). */
const REDIS_SET_PATTERN = /(?:redisConnection|(?:^|[^A-Za-z0-9_])redis)\.set\(/g;
const REDIS_SETEX_PATTERN = /(?:redisConnection|(?:^|[^A-Za-z0-9_])redis)\.setex\(/;
const TTL_FLAG_PATTERN = /['"`](?:EX|PX|EXAT|PXAT|KEEPTTL)['"`]/;
const SET_CALL_WINDOW = 400;

/** Keys that are intentionally persistent (overwritten each run as a gauge-like value, never expired). */
const PERSISTENT_KEY_ALLOWLIST: { file: string; keyFragment: string }[] = [
  {
    file: 'src/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.service.ts',
    keyFragment: 'IDEMPOTENCY_CLAIM_COUNTER_LOGICAL_KEY',
  },
];

function collectSourceFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(absolutePath, collected);
    } else if (entry.name.endsWith('.ts') && !/\.test\.ts$/.test(entry.name)) {
      collected.push(absolutePath);
    }
  }
  return collected;
}

function isAllowlisted(relativePath: string, callWindow: string): boolean {
  return PERSISTENT_KEY_ALLOWLIST.some(
    (entry) => entry.file === relativePath && callWindow.includes(entry.keyFragment),
  );
}

function scanRedisSets(): {
  total: number;
  missingTtl: string[];
  missingTtlBeforeAllowlist: string[];
} {
  const missingTtl: string[] = [];
  const missingTtlBeforeAllowlist: string[] = [];
  let total = 0;
  for (const absolutePath of collectSourceFiles(SRC_ROOT)) {
    const relativePath = relative(process.cwd(), absolutePath);
    if (relativePath.includes('/__tests__/') || relativePath.includes('/tests/')) continue;
    const content = readFileSync(absolutePath, 'utf-8');

    for (const match of content.matchAll(REDIS_SET_PATTERN)) {
      total += 1;
      const start = match.index ?? 0;
      const callWindow = content.slice(start, start + SET_CALL_WINDOW);
      if (REDIS_SETEX_PATTERN.test(callWindow) || TTL_FLAG_PATTERN.test(callWindow)) continue;
      const location = `${relativePath}:${content.slice(0, start).split('\n').length}`;
      missingTtlBeforeAllowlist.push(location);
      if (isAllowlisted(relativePath, callWindow)) continue;
      missingTtl.push(location);
    }
  }
  return { total, missingTtl, missingTtlBeforeAllowlist };
}

describe('redis-set-ttl policy', () => {
  it('every Redis SET sets a TTL (EX/PX/...) or is an allowlisted persistent key', () => {
    expect(scanRedisSets().missingTtl).toEqual([]);
  });

  it('the scan actually detects Redis SET calls (guards against a no-op regex)', () => {
    const { total, missingTtlBeforeAllowlist } = scanRedisSets();
    // There are well over a dozen Redis SET sites; a near-zero count means the detector broke.
    expect(total).toBeGreaterThan(10);
    // The only no-TTL SET today is the allowlisted cardinality counter — proving the allowlist is live.
    expect(missingTtlBeforeAllowlist).toContain(
      'src/infrastructure/observability/idempotency-cardinality/idempotency-cardinality.service.ts:98',
    );
  });
});
