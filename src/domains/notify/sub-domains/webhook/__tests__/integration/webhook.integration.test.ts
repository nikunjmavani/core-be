import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { database } from '@/infrastructure/database/connection.js';
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
import { NOTIFY_PERMISSIONS } from '@/domains/notify/notify.permissions.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import {
  webhook_delivery_attempts,
  webhooks,
} from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { WebhookDeliveryAttemptRepository } from '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery-attempt.repository.js';

const WEBHOOK_PERMISSIONS = [NOTIFY_PERMISSIONS.WEBHOOK_READ, NOTIFY_PERMISSIONS.WEBHOOK_MANAGE];

describe('Webhook Sub-Domain — Integration', () => {
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
    await seedPermissions(WEBHOOK_PERMISSIONS);
  });

  async function createAuthorizedContext(permissionCodes = WEBHOOK_PERMISSIONS) {
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
    // Flat webhook routes resolve the organization from the JWT `org` claim, so
    // the bearer must embed `organizationPublicId` to reach (and pass) the
    // webhook permission preHandler and the org-scoped controller.
    const token = await generateTestToken({
      userId: user.public_id,
      organizationPublicId: organization.public_id,
    });
    return { user, organization, token };
  }

  describe('GET /api/v1/notify/webhooks', () => {
    it('returns 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/webhooks'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 without webhook read permission', async () => {
      const owner = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: owner.id });
      const user = await createTestUser({ email: 'no-webhook@test.com' });
      // Scope the bearer to the org via the `org` claim so the request reaches
      // the webhook permission check; the user has no membership → 403.
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/webhooks'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 200 with webhook read permission', async () => {
      const { token } = await createAuthorizedContext([NOTIFY_PERMISSIONS.WEBHOOK_READ]);
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/webhooks'),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        meta?: { pagination?: { has_more?: boolean; next?: string | null } };
      };
      expect(body.meta?.pagination).toMatchObject({ has_more: false, next: null });
    });

    it('paginates webhooks with after cursor and include_total', { timeout: 30_000 }, async () => {
      const { organization, token } = await createAuthorizedContext([
        NOTIFY_PERMISSIONS.WEBHOOK_READ,
      ]);
      const owner = await createTestUser({ email: `webhook-cursor-owner-${Date.now()}@test.com` });
      const baseCreatedAt = Date.now();
      for (let index = 0; index < 3; index += 1) {
        const webhook = await createTestWebhook({
          organizationId: organization.id,
          url: `https://example.com/cursor-${index}-${baseCreatedAt}`,
          createdByUserId: owner.id,
        });
        const orderedCreatedAt = new Date(baseCreatedAt + index * 1_000);
        await database
          .update(webhooks)
          .set({ created_at: orderedCreatedAt, updated_at: orderedCreatedAt })
          .where(eq(webhooks.id, webhook.id));
      }

      const page1Response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/webhooks'),
        token,
        query: { limit: '2', include_total: 'true' },
      });
      expect(page1Response.statusCode).toBe(200);
      const page1Body = page1Response.json() as {
        data: Array<{ id: string }>;
        meta?: {
          pagination?: {
            has_more?: boolean;
            next?: string | null;
            estimated_total?: number;
            per_page?: number;
          };
        };
      };
      expect(page1Body.data).toHaveLength(2);
      expect(page1Body.meta?.pagination).toMatchObject({
        has_more: true,
        per_page: 2,
        estimated_total: 3,
      });
      expect(page1Body.meta?.pagination?.next).toBeTypeOf('string');

      const page2Response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/notify/webhooks'),
        token,
        query: { limit: '2', after: page1Body.meta!.pagination!.next! },
      });
      expect(page2Response.statusCode).toBe(200);
      const page2Body = page2Response.json() as {
        data: Array<{ id: string }>;
        meta?: { pagination?: { has_more?: boolean; next?: string | null } };
      };
      const page1Ids = new Set(page1Body.data.map((row) => row.id));
      for (const row of page2Body.data) {
        expect(page1Ids.has(row.id)).toBe(false);
      }
      expect(page1Body.data.length + page2Body.data.length).toBe(3);
      expect(page2Body.meta?.pagination).toMatchObject({ has_more: false, next: null });
    });
  });

  describe('GET /api/v1/notify/webhooks/:webhook_id/delivery-attempts', () => {
    it('paginates delivery attempts with after cursor (newest first)', {
      timeout: 30_000,
    }, async () => {
      const { organization, token } = await createAuthorizedContext([
        NOTIFY_PERMISSIONS.WEBHOOK_READ,
      ]);
      const owner = await createTestUser({
        email: `attempt-cursor-owner-${Date.now()}@test.com`,
      });
      const webhook = await createTestWebhook({
        organizationId: organization.id,
        url: `https://example.com/attempts-${Date.now()}`,
        createdByUserId: owner.id,
      });
      const attemptRepository = new WebhookDeliveryAttemptRepository();
      const baseCreatedAt = Date.now();
      for (let index = 0; index < 3; index += 1) {
        const attempt = await attemptRepository.create({
          webhook_id: webhook.id,
          event_type: 'subscription.updated',
          payload: { id: `evt_${index}` },
          status: 'SENT',
          http_status_code: 200,
          response_body: 'ok',
          sent_at: new Date(),
          attempt_count: 1,
        });
        await database
          .update(webhook_delivery_attempts)
          .set({ created_at: new Date(baseCreatedAt + index * 1_000) })
          .where(eq(webhook_delivery_attempts.id, attempt.id));
      }

      const page1Response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/webhooks/${webhook.public_id}/delivery-attempts`),
        token,
        query: { limit: '2' },
      });
      expect(page1Response.statusCode).toBe(200);
      const page1Body = page1Response.json() as {
        data: unknown[];
        meta?: { pagination?: { has_more?: boolean; next?: string | null } };
      };
      expect(page1Body.data).toHaveLength(2);
      expect(page1Body.meta?.pagination).toMatchObject({ has_more: true });
      expect(page1Body.meta?.pagination?.next).toBeTypeOf('string');

      const page2Response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/webhooks/${webhook.public_id}/delivery-attempts`),
        token,
        query: { limit: '2', after: page1Body.meta!.pagination!.next! },
      });
      expect(page2Response.statusCode).toBe(200);
      const page2Body = page2Response.json() as {
        data: unknown[];
        meta?: { pagination?: { has_more?: boolean; next?: string | null } };
      };
      expect(page1Body.data.length + page2Body.data.length).toBe(3);
      expect(page2Body.meta?.pagination).toMatchObject({ has_more: false, next: null });
    });
  });

  describe('DELETE /api/v1/notify/webhooks/:webhook_id', () => {
    it('returns 204 with webhook manage permission', async () => {
      const { user, organization, token } = await createAuthorizedContext();
      const webhook = await createTestWebhook({
        organizationId: organization.id,
        url: 'https://example.com/delete-happy-path',
        createdByUserId: user.id,
      });

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/notify/webhooks/${webhook.public_id}`),
        token,
      });
      expect(response.statusCode, response.body).toBe(204);
    });
  });
});
