import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const idempotencyMiddlewarePath = join(
  process.cwd(),
  'src/shared/middlewares/idempotency.middleware.ts',
);

describe('idempotency cached body cap policy', () => {
  it('defines 100KB max cached response body and skips Redis set when exceeded', () => {
    const source = readFileSync(idempotencyMiddlewarePath, 'utf8');
    expect(source).toContain('IDEMPOTENCY_CACHED_BODY_BYTES');
    expect(source).toContain('idempotency.cache.body.too_large');
    expect(source).toContain('bodyByteLength > IDEMPOTENCY_CACHED_BODY_BYTES');
    expect(source).toContain('redisConnection.del(cacheKey)');
  });

  it('uses discriminated state machine entries (no fake CachedResponse placeholder)', () => {
    const source = readFileSync(idempotencyMiddlewarePath, 'utf8');
    expect(source).toContain("state: 'in_flight'");
    expect(source).toContain("state: 'completed'");
    expect(source).toContain('errors:idempotencyKeyInFlight');
    // The placeholder must not be serialised as a fully formed CachedResponse-style payload.
    // We strip JSDoc comments before checking so the migration-path doc reference is ignored.
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sourceWithoutComments).not.toMatch(/JSON\.stringify\(\s*\{\s*statusCode:\s*202/);
  });
});
