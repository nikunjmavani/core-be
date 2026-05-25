import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { createTestWebhook } from '@/tests/factories/webhook.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import type { FastifyInstance } from 'fastify';

const NOTIFY_PERMISSIONS = {
  WEBHOOK_READ: 'webhook:read',
  WEBHOOK_MANAGE: 'webhook:manage',
} as const;

const ALL_NOTIFY_PERMISSIONS = Object.values(NOTIFY_PERMISSIONS);

describe('Notify Domain — Integration', () => {
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
    await seedPermissions(ALL_NOTIFY_PERMISSIONS);
  });

  async function createAuthorizedNotifyContext(permissionCodes = ALL_NOTIFY_PERMISSIONS) {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes,
    });
    await createMembership({
      userId: user.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const token = await generateTestToken({ userId: user.public_id });
    return { user, organization, role, token };
  }

  // ─── Notifications ────────────────────────────────────────────

  describe('GET /api/v1/notify/notifications', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/notifications'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return notifications for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/notifications'),
        token: token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/notify/notifications/:id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/notifications/test-id'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('PATCH /api/v1/notify/notifications/:id/read', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PATCH',
        url: testApiPath('/notify/notifications/test-id/read'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/notify/notifications/mark-all-read', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/notify/notifications/mark-all-read'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/notify/notifications/unread-count', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/notifications/unread-count'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return unread count for authenticated user', async () => {
      const user = await createTestUser();
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/notifications/unread-count'),
        token: token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('DELETE /api/v1/notify/notifications/:notificationId', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: testApiPath('/notify/notifications/test-id'),
      });
      expect(response.statusCode).toBe(401);
    });
  });

  // ─── Webhooks ─────────────────────────────────────────────────

  describe('GET /api/v1/notify/organizations/:id/webhooks', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/organizations/some-id/webhooks'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without webhook read permission', async () => {
      const { organization } = await createAuthorizedNotifyContext();
      const user = await createTestUser({ email: 'noperm@test.com' });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/organizations/${organization.public_id}/webhooks`),
        token: token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return webhooks with permission', async () => {
      const { organization, token } = await createAuthorizedNotifyContext();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/organizations/${organization.public_id}/webhooks`),
        token: token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /api/v1/notify/organizations/:id/webhooks', () => {
    it('should return 400 or 422 for invalid webhook payload', async () => {
      const { organization, token } = await createAuthorizedNotifyContext();
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/notify/organizations/${organization.public_id}/webhooks`),
        token: token,
        payload: { url: 'not-a-url', events: [] },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 403 without manage permission', async () => {
      const { organization } = await createAuthorizedNotifyContext([
        NOTIFY_PERMISSIONS.WEBHOOK_READ,
      ]);
      const user = await createTestUser({ email: 'readonly@test.com' });
      const readRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [NOTIFY_PERMISSIONS.WEBHOOK_READ],
      });
      await createMembership({
        userId: user.id,
        organizationId: organization.id,
        roleId: readRole.id,
      });
      const token = await generateTestToken({ userId: user.public_id });
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/notify/organizations/${organization.public_id}/webhooks`),
        token: token,
        payload: {},
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // ─── Webhook Test Delivery ──────────────────────────────────

  describe('POST /api/v1/notify/organizations/:id/webhooks/:webhookId/test', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath('/notify/organizations/some-id/webhooks/some-webhook-id/test'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without webhook:manage permission', async () => {
      const { organization, user } = await createAuthorizedNotifyContext();
      // Create a second user with only READ permission
      const readUser = await createTestUser({ email: 'readonlywebhook@test.com' });
      const readRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [NOTIFY_PERMISSIONS.WEBHOOK_READ],
      });
      await createMembership({
        userId: readUser.id,
        organizationId: organization.id,
        roleId: readRole.id,
      });
      const readToken = await generateTestToken({ userId: readUser.public_id });

      const webhook = await createTestWebhook({
        organizationId: organization.id,
        createdByUserId: user.id,
      });

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(
          `/notify/organizations/${organization.public_id}/webhooks/${webhook.public_id}/test`,
        ),
        token: readToken,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should send test delivery and return result with manage permission', {
      timeout: 15_000,
    }, async () => {
      const { organization, user, token } = await createAuthorizedNotifyContext();
      const webhook = await createTestWebhook({
        organizationId: organization.id,
        url: 'https://httpbin.org/post',
        createdByUserId: user.id,
      });

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(
          `/notify/organizations/${organization.public_id}/webhooks/${webhook.public_id}/test`,
        ),
        token: token,
      });

      // External httpbin.org may be slow or return 5xx
      expect([200, 500]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty(
          'success',
        );
        expect((response.json() as { data: Record<string, unknown> }).data).toHaveProperty(
          'delivered_at',
        );
        expect(typeof (response.json() as { data: Record<string, unknown> }).data.success).toBe(
          'boolean',
        );
      }
    });

    it('should return 404 for non-existent webhook', async () => {
      const { organization, token } = await createAuthorizedNotifyContext();
      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(
          `/notify/organizations/${organization.public_id}/webhooks/wwwwwwwwwwwwwwwwwwwww/test`,
        ),
        token: token,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // ─── Webhook Events ───────────────────────────────────────────

  describe('GET /api/v1/notify/organizations/:id/webhook-events', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/organizations/some-id/webhook-events'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return webhook events with permission', async () => {
      const { organization, token } = await createAuthorizedNotifyContext();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/organizations/${organization.public_id}/webhook-events`),
        token: token,
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
