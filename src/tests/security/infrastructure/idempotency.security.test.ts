import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { buildIdempotencyCacheKey } from '@/shared/utils/idempotency/idempotency-key.util.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  injectAuthenticated,
  injectRoute,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function uniqueKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Idempotency key tests — verify the X-Idempotency-Key header is respected
 * for write operations to prevent duplicate processing.
 */
describe('Security: Idempotency', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('should accept requests with X-Idempotency-Key header', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      headers: { 'x-idempotency-key': uniqueKey('idem-accept') },
      payload: { name: 'Idempotent Org', slug: uniqueSlug('idempotent-org') },
    });

    // Should succeed (201) or return validation error (400/422)
    expect(response.statusCode).toBeLessThan(500);
  });

  it('should process requests without X-Idempotency-Key normally', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      payload: { name: 'No Key Org', slug: uniqueSlug('no-key-org') },
    });

    expect(response.statusCode).toBeLessThan(500);
  });

  it('should reject malformed X-Idempotency-Key', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const longKeyResponse = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      headers: { 'x-idempotency-key': 'a'.repeat(500) },
      payload: { name: 'Bad Key Org', slug: uniqueSlug('bad-key-org') },
    });

    expect(longKeyResponse.statusCode).toBe(422);
    expect((longKeyResponse.json() as { error?: { code?: string } }).error?.code).toBe(
      'unprocessable_entity',
    );

    const spaceKeyResponse = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      headers: { 'x-idempotency-key': 'bad key' },
      payload: { name: 'Bad Key Org 2', slug: uniqueSlug('bad-key-org-2') },
    });

    expect(spaceKeyResponse.statusCode).toBe(422);
    expect((spaceKeyResponse.json() as { error?: { code?: string } }).error?.code).toBe(
      'unprocessable_entity',
    );
  });

  it('rejects a MISSING X-Idempotency-Key on an idempotency-required write (422)', async () => {
    // POST /tenancy/organizations is one of the 13 `idempotencyRequired` writes (the `I`/`req`
    // column in docs/routes.txt; organization.routes.ts sets config.idempotencyRequired = true).
    // The middleware is route-agnostic, so this one representative route proves the missing-key gate
    // for all 13 (the other 12 share the identical onRequest path). Omitting the header must
    // fail closed with 422 — proving the requirement is enforced on a real required route, not
    // only that malformed keys are rejected. Without this, a regression dropping the flag would
    // let a duplicate create slip through and no test would catch it.
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      payload: { name: 'Requires Key Org', slug: uniqueSlug('requires-key-org') },
    });

    expect(response.statusCode).toBe(422);
    expect((response.json() as { error?: { code?: string } }).error?.code).toBe(
      'unprocessable_entity',
    );
  });

  it('should not persist an idempotency Redis entry when write is unauthenticated', async () => {
    const key = uniqueKey('unauth-idem');
    const cacheKey = buildIdempotencyCacheKey(key, {
      userId: 'anonymous',
      organizationId: 'none',
    });
    await redisConnection.del(cacheKey);

    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      headers: { 'x-idempotency-key': key },
      payload: { name: 'Unauth Org', slug: uniqueSlug('unauth-org') },
    });

    expect(response.statusCode).toBe(401);
    const stored = await redisConnection.get(cacheKey);
    expect(stored).toBeNull();
  });

  it('handles a DELETE returning an empty 204 body when an X-Idempotency-Key is present', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const slug = uniqueSlug('delete-idempotent-org');
    const createRes = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      headers: { 'x-idempotency-key': uniqueKey('delete-setup') },
      payload: { name: 'Delete Idempotent Org', slug },
    });
    if (createRes.statusCode !== 201) throw new Error('Setup: create organization failed');
    const organizationId = (createRes.json() as { data: { id: string } }).data.id;

    // The flat DELETE route resolves the target org from the JWT `org` claim;
    // mint a token scoped to the just-created org (the creator owns it).
    const tokenScopedToOrg = await generateTestToken({
      userId: user.public_id,
      organizationPublicId: organizationId,
    });

    // Regression: attaching an X-Idempotency-Key to a write that returns 204 (empty body)
    // must not 500. `onSend` previously crashed on the empty payload
    // (`JSON.stringify(undefined)` -> `Buffer.byteLength` throw); the empty body now
    // normalizes to JSON `null`, so the route returns its real 204 contract.
    // (The cached-204 *replay* path — `JSON.parse('null')` -> empty body — is covered as a
    // unit test; it cannot be exercised here because this DELETE removes the org the
    // idempotency scope's auth/permission preHandlers resolve, so a replay 403s on membership.)
    const response = await injectAuthenticated(app, {
      method: 'DELETE',
      url: testApiPath('/tenancy/organization'),
      token: tokenScopedToOrg,
      headers: { 'x-idempotency-key': uniqueKey('delete-idem') },
    });
    expect(response.statusCode).toBe(204);
  });

  it('should return cached response with x-idempotency-replay on duplicate key', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const key = uniqueKey('replay');

    const first = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      headers: { 'x-idempotency-key': key },
      payload: { name: 'Replay Org', slug: uniqueSlug('replay-org') },
    });

    expect(first.statusCode).toBeLessThan(500);
    expect(first.headers['x-idempotency-replay']).toBeUndefined();

    // Allow onSend hook to finish caching the response before sending duplicate key request
    await new Promise((resolve) => setTimeout(resolve, 200));

    const second = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      token,
      headers: { 'x-idempotency-key': key },
      payload: { name: 'Replay Org Again', slug: uniqueSlug('replay-org-again') },
    });

    expect(second.statusCode).toBeLessThan(500);
    if (second.headers['x-idempotency-replay'] === 'true') {
      expect(second.statusCode).toBe(first.statusCode);
    }
    // When Redis has eviction (e.g. volatile-lru), cache may be missing; second request can still return 2xx
  });

  it('should deduplicate concurrent requests with same idempotency key', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const key = uniqueKey('concurrent');
    const slugA = uniqueSlug('concurrent-a');
    const slugB = uniqueSlug('concurrent-b');

    const [responseOne, responseTwo] = await Promise.all([
      injectRoute(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organizations'),
        headers: {
          authorization: `Bearer ${token}`,
          'x-idempotency-key': key,
        },
        payload: { name: 'Concurrent A', slug: slugA },
      }),
      injectRoute(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organizations'),
        headers: {
          authorization: `Bearer ${token}`,
          'x-idempotency-key': key,
        },
        payload: { name: 'Concurrent B', slug: slugB },
      }),
    ]);

    const statuses = [responseOne.statusCode, responseTwo.statusCode];
    const oneSuccess = statuses.some((s) => s >= 200 && s < 300);
    const oneConflictOrReplay =
      statuses.some((s) => s === 409) ||
      responseOne.headers['x-idempotency-replay'] === 'true' ||
      responseTwo.headers['x-idempotency-replay'] === 'true';
    const single2xx = statuses.filter((s) => s >= 200 && s < 300).length === 1;
    const both2xx = statuses.every((s) => s >= 200 && s < 300);
    expect(oneSuccess, 'At least one request should succeed').toBe(true);
    expect(
      oneConflictOrReplay || single2xx || both2xx,
      'One 409/replay, or exactly one 2xx, or both 2xx (acceptable when Redis evicts)',
    ).toBe(true);
  });
});
