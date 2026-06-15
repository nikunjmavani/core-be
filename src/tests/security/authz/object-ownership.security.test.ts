import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestToken, generateTestTokenAndSession } from '@/tests/helpers/test-auth.js';
import {
  seedTwoOrganizationsWithSubscriptions,
  seedUploadForOrganization,
} from '@/tests/helpers/test-organization.js';
import { createTestNotification } from '@/tests/factories/notification.factory.js';
import { createTestMfaMethod } from '@/tests/factories/mfa-method.factory.js';
import { createTestUserDataExport } from '@/tests/factories/user-data-export.factory.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { database } from '@/infrastructure/database/connection.js';
import { uploads } from '@/domains/upload/upload.schema.js';
import { notifications } from '@/domains/notify/sub-domains/notification/notification.schema.js';
import { sessions } from '@/domains/auth/sub-domains/auth-session/auth-session.schema.js';
import { mfa_methods } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa-method.schema.js';
import { auth_methods } from '@/domains/auth/sub-domains/auth-method/auth-method.schema.js';

/**
 * Object-ownership (BOLA) attack matrix — Phase 2 of the in-house authorization
 * matrix (route-authorization-model.json). For each model, a different principal
 * is denied the victim's object (`user`→404, `org`→404), the legitimate owner
 * still succeeds (baseline), and denied writes leave state unchanged
 * (verifyNoMutation). e2e — runs in CI (Postgres + Redis required).
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

  // ─── model: user — two peer users; B must never reach A's object ────────────

  async function twoUsers() {
    const victim = await createTestUser();
    const attacker = await createTestUser();
    const victimToken = await generateTestToken({ userId: victim.public_id });
    const attackerToken = await generateTestToken({ userId: attacker.public_id });
    return { victim, attacker, victimToken, attackerToken };
  }

  describe('model: user — uploads', () => {
    it("attacker GET victim's upload → 404", async () => {
      const { victim, attackerToken } = await twoUsers();
      const upload = await seedUploadForOrganization({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/uploads/${upload.public_id}`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
    });

    it('baseline: owner GET own upload → 200', async () => {
      const { victim, victimToken } = await twoUsers();
      const upload = await seedUploadForOrganization({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/uploads/${upload.public_id}`),
        token: victimToken,
      });
      expect(res.statusCode).toBe(200);
    });

    it("attacker DELETE victim's upload → 404 and row not soft-deleted", async () => {
      const { victim, attackerToken } = await twoUsers();
      const upload = await seedUploadForOrganization({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/uploads/${upload.public_id}`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
      const [row] = await database
        .select()
        .from(uploads)
        .where(eq(uploads.public_id, upload.public_id));
      expect(row?.deleted_at).toBeNull();
    });
  });

  describe('model: user — notifications', () => {
    it("attacker GET victim's notification → 404", async () => {
      const { victim, attackerToken } = await twoUsers();
      const notification = await createTestNotification({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/notifications/${notification.public_id}`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
    });

    it('baseline: owner GET own notification → 200', async () => {
      const { victim, victimToken } = await twoUsers();
      const notification = await createTestNotification({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/notifications/${notification.public_id}`),
        token: victimToken,
      });
      expect(res.statusCode).toBe(200);
    });

    it("attacker DELETE victim's notification → 404 and row still present", async () => {
      const { victim, attackerToken } = await twoUsers();
      const notification = await createTestNotification({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/notify/notifications/${notification.public_id}`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
      const rows = await database
        .select()
        .from(notifications)
        .where(eq(notifications.public_id, notification.public_id));
      expect(rows).toHaveLength(1);
    });

    it("attacker PATCH read on victim's notification → 404 and still unread", async () => {
      const { victim, attackerToken } = await twoUsers();
      const notification = await createTestNotification({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(`/notify/notifications/${notification.public_id}/read`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
      const [row] = await database
        .select()
        .from(notifications)
        .where(eq(notifications.public_id, notification.public_id));
      expect(row?.is_read).toBe(false);
    });
  });

  describe('model: user — data exports', () => {
    it("attacker GET victim's data export → 404", async () => {
      const { victim, attackerToken } = await twoUsers();
      const exportRow = await createTestUserDataExport({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/users/me/data-export/${exportRow.public_id}`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
    });

    it('baseline: owner GET own data export → 200', async () => {
      const { victim, victimToken } = await twoUsers();
      const exportRow = await createTestUserDataExport({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/users/me/data-export/${exportRow.public_id}`),
        token: victimToken,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('model: user — sessions', () => {
    it("attacker DELETE victim's session → 404 and session not revoked", async () => {
      const victim = await createTestUser();
      const attacker = await createTestUser();
      const { sessionPublicId } = await generateTestTokenAndSession({ userId: victim.public_id });
      const attackerToken = await generateTestToken({ userId: attacker.public_id });
      const res = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/sessions/${sessionPublicId}`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
      const [row] = await database
        .select()
        .from(sessions)
        .where(eq(sessions.public_id, sessionPublicId));
      expect(row?.is_revoked).toBe(false);
    });

    it('baseline: owner DELETE own session → 204', async () => {
      const victim = await createTestUser();
      const { token, sessionPublicId } = await generateTestTokenAndSession({
        userId: victim.public_id,
      });
      const res = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/sessions/${sessionPublicId}`),
        token,
      });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('model: user — MFA methods', () => {
    it("attacker DELETE victim's MFA method → 404 and not revoked", async () => {
      const { victim, attackerToken } = await twoUsers();
      const method = await createTestMfaMethod({ userId: victim.id });
      const res = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/mfa/${method.public_id}`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
      const [row] = await database
        .select()
        .from(mfa_methods)
        .where(eq(mfa_methods.public_id, method.public_id));
      expect(row?.revoked_at).toBeNull();
    });
  });

  describe('model: user — auth methods', () => {
    it("attacker DELETE victim's auth method → 404", async () => {
      const { victim, attackerToken } = await twoUsers();
      const [authMethod] = await database
        .insert(auth_methods)
        .values({
          public_id: generatePublicId('authMethod'),
          user_id: victim.id,
          method_type: 'PASSWORD',
          is_primary: true,
        })
        .returning();
      const res = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/auth/me/auth-methods/${authMethod!.public_id}`),
        token: attackerToken,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── model: org — member of org A must not reach org B's object ─────────────

  describe('model: org — subscriptions (cross-org)', () => {
    it("member of org A GET org B's subscription → 404", async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();
      const tokenScopedToOrgA = await generateTestToken({
        userId: fixture.userA.public_id,
        organizationPublicId: fixture.organizationA.public_id,
      });
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/subscriptions/${fixture.subscriptionInB.public_id}`),
        token: tokenScopedToOrgA,
        organizationPublicId: fixture.organizationA.public_id,
      });
      expect(res.statusCode).toBe(404);
    });

    it('baseline: member GET own org subscription → 200', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();
      const tokenScopedToOrgA = await generateTestToken({
        userId: fixture.userA.public_id,
        organizationPublicId: fixture.organizationA.public_id,
      });
      const res = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/subscriptions/${fixture.subscriptionInA.public_id}`),
        token: tokenScopedToOrgA,
        organizationPublicId: fixture.organizationA.public_id,
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
