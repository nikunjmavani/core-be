import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestPlan } from '@/tests/factories/plan.factory.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { seedPermissions } from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import type { FastifyInstance } from 'fastify';

/**
 * Billing permissions imported inline to avoid cross-domain coupling in test setup.
 */
const BILLING_PERMISSIONS = {
  SUBSCRIPTION_READ: 'subscription:read',
  SUBSCRIPTION_MANAGE: 'subscription:manage',
} as const;

const ALL_BILLING_PERMISSIONS = Object.values(BILLING_PERMISSIONS);

describe('Billing Domain — Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions(ALL_BILLING_PERMISSIONS);
  });

  async function createAuthenticatedToken(): Promise<string> {
    const user = await createTestUser();
    return generateTestToken({ userId: user.public_id });
  }

  // ─── Plans (public read) ────────────────────────────────────

  describe('GET /api/v1/billing/plans', () => {
    it('should return plans without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/plans'),
      });
      expect(response.statusCode).toBe(200);
    });

    it('should return plans with authentication', async () => {
      const token = await createAuthenticatedToken();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/plans'),
        token,
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toBeDefined();
    });

    it('should include created plan in list', async () => {
      await createTestPlan({ name: 'Pro Plan' });
      const token = await createAuthenticatedToken();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/plans'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const planNames = ((response.json() as { data: Array<{ name: string }> }).data ?? []).map(
        (plan) => plan.name,
      );
      expect(planNames).toContain('Pro Plan');
    });
  });

  describe('GET /api/v1/billing/plans/:id', () => {
    it('should return plan without authentication', async () => {
      const plan = await createTestPlan();
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/plans/${plan.public_id}`),
      });
      expect(response.statusCode).toBe(200);
    });

    it('should return plan by public ID', async () => {
      const plan = await createTestPlan();
      const token = await createAuthenticatedToken();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/plans/${plan.public_id}`),
        token,
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as { data: Record<string, unknown> }).data).toBeDefined();
    });

    it('should return 404 for non-existent plan', async () => {
      const token = await createAuthenticatedToken();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/billing/plans/nonexistent'),
        token,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
