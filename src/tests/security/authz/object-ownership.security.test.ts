import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedTwoOrganizationsWithSubscriptions,
  seedUploadForOrganization,
} from '@/tests/helpers/test-organization.js';
import { database } from '@/infrastructure/database/connection.js';
import { uploads } from '@/domains/upload/upload.schema.js';

/**
 * Object-ownership (BOLA) attack matrix — Phase 2 of the in-house authorization
 * matrix (see docs/reference/security/authorization-testing-plan.md). For each
 * authorization model in route-authorization-model.json, an attacker is denied
 * the victim's object and a positive baseline proves the guard is specific.
 *
 * Wired so far: `user` (uploads, reusing seedUploadForOrganization) and `org`
 * (subscriptions, reusing seedTwoOrganizationsWithSubscriptions). Remaining
 * resources land as their fixtures are added. The e2e assertions run in CI
 * (reusable-vitest-postgres-redis); they require Postgres + Redis.
 */
describe('Security: object-ownership BOLA matrix', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  describe('model: user — uploads (cross-user)', () => {
    async function setupVictimUpload() {
      const victim = await createTestUser();
      const attacker = await createTestUser();
      const victimToken = await generateTestToken({ userId: victim.public_id });
      const attackerToken = await generateTestToken({ userId: attacker.public_id });
      const upload = await seedUploadForOrganization({ userId: victim.id });
      return { victim, attacker, victimToken, attackerToken, upload };
    }

    it("attacker GET of victim's upload → 404", async () => {
      const { attackerToken, upload } = await setupVictimUpload();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/uploads/${upload.public_id}`),
        token: attackerToken,
      });
      expect(response.statusCode).toBe(404);
    });

    it('baseline: owner GET of own upload → 200', async () => {
      const { victimToken, upload } = await setupVictimUpload();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/uploads/${upload.public_id}`),
        token: victimToken,
      });
      expect(response.statusCode).toBe(200);
    });

    it("attacker DELETE of victim's upload → 404 and row not soft-deleted (verifyNoMutation)", async () => {
      const { attackerToken, upload } = await setupVictimUpload();
      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/uploads/${upload.public_id}`),
        token: attackerToken,
      });
      expect(response.statusCode).toBe(404);

      const [row] = await database
        .select()
        .from(uploads)
        .where(eq(uploads.public_id, upload.public_id));
      expect(row?.deleted_at).toBeNull();
    });
  });

  describe('model: org — subscriptions (cross-org)', () => {
    it("member of org A GET of org B's subscription → 404", async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();
      const tokenScopedToOrgA = await generateTestToken({
        userId: fixture.userA.public_id,
        organizationPublicId: fixture.organizationA.public_id,
      });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/subscriptions/${fixture.subscriptionInB.public_id}`),
        token: tokenScopedToOrgA,
        organizationPublicId: fixture.organizationA.public_id,
      });
      expect(response.statusCode).toBe(404);
    });

    it('baseline: member GET of own org subscription → 200', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();
      const tokenScopedToOrgA = await generateTestToken({
        userId: fixture.userA.public_id,
        organizationPublicId: fixture.organizationA.public_id,
      });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/subscriptions/${fixture.subscriptionInA.public_id}`),
        token: tokenScopedToOrgA,
        organizationPublicId: fixture.organizationA.public_id,
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
