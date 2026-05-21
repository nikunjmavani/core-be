import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const permissionCacheServicePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../permission-cache.service.ts',
);

function extractWithPermissionCacheRecomputeLockBody(source: string): string {
  const start = source.indexOf('export async function withPermissionCacheRecomputeLock');
  expect(start).toBeGreaterThanOrEqual(0);
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index++) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error('withPermissionCacheRecomputeLock body not found');
}

describe('permission-cache lock ordering policy', () => {
  it('awaits setCachedPermissions before releasing recompute lock in finally', () => {
    const source = readFileSync(permissionCacheServicePath, 'utf8');
    const functionBody = extractWithPermissionCacheRecomputeLockBody(source);

    const setCachedIndex = functionBody.indexOf('await setCachedPermissions');
    const finallyIndex = functionBody.indexOf('} finally {');
    const lockDelIndex = functionBody.indexOf('redisConnection.del(lockKey)', finallyIndex);

    expect(setCachedIndex).toBeGreaterThanOrEqual(0);
    expect(finallyIndex).toBeGreaterThan(setCachedIndex);
    expect(lockDelIndex).toBeGreaterThan(finallyIndex);
  });
});
