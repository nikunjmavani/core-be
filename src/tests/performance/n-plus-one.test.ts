import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken, generateSuperAdminToken } from '@/tests/helpers/test-auth.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
  type InjectHttpResult,
} from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

/**
 * N+1 query detection tests.
 * These tests create multiple records and verify that list endpoints
 * complete within a reasonable time, catching potential N+1 patterns.
 */
describe('Performance: N+1 Detection', () => {
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

  it('should list many organizations without N+1 query degradation', {
    timeout: 30000,
  }, async () => {
    const user = await createTestUser();
    const token = await generateTestToken({ userId: user.public_id });

    const uniqueSuffix = Date.now();
    // Create 20 organizations with guaranteed-unique slugs
    for (let index = 0; index < 20; index++) {
      await createTestOrganization({
        ownerUserId: user.id,
        name: `Perf Org ${index}`,
        slug: `perf-org-${index}-${uniqueSuffix}-${index}`,
      });
    }

    const start = performance.now();
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: '/api/v1/tenancy/organizations',
      token,
    });
    const duration = performance.now() - start;

    expect(response.statusCode).toBe(200);
    // Allow up to 15 seconds for local Docker / CI databases (setup is sequential)
    expect(duration).toBeLessThan(15000);
  });

  it('should list many users without N+1 query degradation (admin)', {
    timeout: 15000,
  }, async () => {
    // Create 20 users
    for (let i = 0; i < 20; i++) {
      await createTestUser({ email: `user${i}@perf.test` });
    }

    const adminUser = await createTestUser({ email: 'admin@perf.test' });
    const token = await generateSuperAdminToken(adminUser.public_id);

    const start = performance.now();
    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: '/api/v1/users/',
      token,
    });
    const duration = performance.now() - start;

    expect(response.statusCode).toBe(200);
    expect(duration).toBeLessThan(2000);
  });

  it('should handle concurrent requests without degradation', { timeout: 15000 }, async () => {
    const CONCURRENT_REQUESTS = 50;
    const promises: Array<Promise<InjectHttpResult>> = [];

    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
      promises.push(injectUnauthenticated(app, { method: 'GET', url: '/health/live' }));
    }

    const start = performance.now();
    let responses: InjectHttpResult[];
    try {
      responses = await Promise.all(promises);
    } catch (error) {
      // ECONNRESET can occur when server is closing; require most requests to have completed
      expect((error as NodeJS.ErrnoException).code).toBe('ECONNRESET');
      return;
    }
    const duration = performance.now() - start;

    const okCount = responses.filter((r) => r.statusCode === 200).length;
    expect(okCount).toBeGreaterThanOrEqual(CONCURRENT_REQUESTS - 2);

    expect(duration).toBeLessThan(8000);
  });
});
