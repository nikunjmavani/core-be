import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { buildIdempotencyCacheKey } from '@/shared/utils/idempotency/idempotency-key.util.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

describe('Integration: idempotency in-flight returns 409', () => {
  let application: FastifyInstance;

  beforeAll(async () => {
    const testApplication = await createTestApp();
    application = testApplication.app;
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(async () => {
    const keys = await redisConnection.keys('*idempotency*');
    if (keys.length > 0) {
      await redisConnection.del(...keys);
    }
  });

  it('returns 409 conflict_in_flight for legacy 202 placeholder in Redis', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const idempotencyKey = `test-in-flight-${Date.now()}`;
    const cacheKey = buildIdempotencyCacheKey(idempotencyKey, { userId: user.public_id });
    await redisConnection.set(
      cacheKey,
      JSON.stringify({ statusCode: 202, body: '{}', headers: {} }),
      'EX',
      60,
    );

    const response = await application.inject({
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      headers: {
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      payload: { name: 'Org', slug: `org-${Date.now()}` },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('conflict_in_flight');
  });

  it('returns 409 for explicit in_flight state', async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });
    const idempotencyKey = `test-in-flight-explicit-${Date.now()}`;
    const cacheKey = buildIdempotencyCacheKey(idempotencyKey, { userId: user.public_id });
    await redisConnection.set(
      cacheKey,
      JSON.stringify({ state: 'in_flight', claimedAt: Date.now() }),
      'EX',
      60,
    );

    const response = await application.inject({
      method: 'POST',
      url: testApiPath('/tenancy/organizations'),
      headers: {
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      payload: { name: 'Org 2', slug: `org2-${Date.now()}` },
    });

    expect(response.statusCode).toBe(409);
  });
});
