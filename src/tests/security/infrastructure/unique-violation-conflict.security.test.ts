import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticatedOrganizationMutation } from '@/tests/helpers/test-http-inject.helper.js';
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

/**
 * Unique-violation conflict handling for organization-scoped writes.
 *
 * Several resources carry a composite unique constraint — webhooks
 * `(organization_id, url)`, memberships `(user_id, organization_id)`. A write
 * that collides with an existing row, whether issued sequentially or under a
 * concurrent race, must resolve to a clean 409 conflict rather than leaking the
 * raw Postgres unique_violation as a 500 (with a false Sentry capture).
 *
 * The webhook delivery DNS pin is mocked so the update path reaches the database
 * write (rather than failing the SSRF resolve on a non-resolvable test host).
 */
vi.mock('@/shared/utils/security/webhook-outbound-fetch.util.js', () => ({
  resolveAndPinWebhookUrl: vi.fn(async (url: string) => ({ pinnedAddress: '93.184.216.34', url })),
  createPinnedWebhookFetch: vi.fn(async () => async () => new Response('{}', { status: 200 })),
}));

function tally(statuses: number[]) {
  return {
    created: statuses.filter((s) => s === 201).length,
    conflict: statuses.filter((s) => s === 409).length,
    serverError: statuses.filter((s) => s >= 500).length,
  };
}

describe('Security: unique-violation conflict handling', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('webhook url collision (PATCH)', () => {
    beforeEach(async () => {
      await cleanupDatabase();
      await seedPermissions(['webhook:read', 'webhook:manage']);
    });

    async function webhookAdminContext() {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      const role = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: ['webhook:read', 'webhook:manage'],
      });
      await createMembership({ userId: user.id, organizationId: organization.id, roleId: role.id });
      // Flat webhook routes resolve the organization from the JWT `org` claim.
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      return { organization, token };
    }

    function patchWebhookUrl(token: string, webhookPublicId: string, url: string) {
      return injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: testApiPath(`/notify/webhooks/${webhookPublicId}`),
        token,
        payload: { url },
      });
    }

    it('changing a webhook url to another existing webhook url is a clean 409 (not 500)', async () => {
      const { organization, token } = await webhookAdminContext();
      const first = await createTestWebhook({
        organizationId: organization.id,
        url: 'https://alpha.example.com/hook',
      });
      await createTestWebhook({
        organizationId: organization.id,
        url: 'https://beta.example.com/hook',
      });

      const response = await patchWebhookUrl(
        token,
        first.public_id,
        'https://beta.example.com/hook',
      );
      expect(response.statusCode).toBe(409);
    });

    it('changing a webhook url to a genuinely new url still succeeds (200)', async () => {
      const { organization, token } = await webhookAdminContext();
      const first = await createTestWebhook({
        organizationId: organization.id,
        url: 'https://alpha.example.com/hook',
      });

      const response = await patchWebhookUrl(
        token,
        first.public_id,
        'https://unique-target.example.com/hook',
      );
      expect(response.statusCode).toBe(200);
    });
  });

  describe('membership duplicate (POST)', () => {
    beforeEach(async () => {
      await cleanupDatabase();
      await seedPermissions(['membership:manage', 'membership:read', 'role:read']);
    });

    async function membershipAdminContext() {
      const owner = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: owner.id });
      const adminRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: ['membership:manage', 'membership:read', 'role:read'],
      });
      await createMembership({
        userId: owner.id,
        organizationId: organization.id,
        roleId: adminRole.id,
      });
      const memberRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: ['membership:read'],
      });
      // Flat membership routes resolve the organization from the JWT `org` claim.
      const token = await generateTestToken({
        userId: owner.public_id,
        organizationPublicId: organization.public_id,
      });
      const targetUser = await createTestUser();
      return { organization, token, memberRolePublicId: memberRole.public_id, targetUser };
    }

    function addMember(token: string, userPublicId: string, rolePublicId: string) {
      return injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organization/memberships'),
        token,
        extraHeaders: { 'x-idempotency-key': randomUUID() },
        // INVITED keeps joined_at null (chk_memberships_joined allows it); the test
        // targets the (user_id, organization_id) unique constraint, not the activation rule.
        payload: { user_id: userPublicId, role_id: rolePublicId, status: 'INVITED' },
      });
    }

    it('adding the same user twice is a clean 409 (not 500)', async () => {
      const { token, memberRolePublicId, targetUser } = await membershipAdminContext();

      const first = await addMember(token, targetUser.public_id, memberRolePublicId);
      expect(first.statusCode).toBe(201);

      const second = await addMember(token, targetUser.public_id, memberRolePublicId);
      expect(second.statusCode).toBe(409);
    });

    it('concurrent adds of the same user: exactly one 201, rest 409, no 5xx', async () => {
      const { token, memberRolePublicId, targetUser } = await membershipAdminContext();

      const statuses = await Promise.all(
        Array.from({ length: 4 }, () =>
          addMember(token, targetUser.public_id, memberRolePublicId).then((r) => r.statusCode),
        ),
      );
      const result = tally(statuses);
      expect(result.serverError).toBe(0);
      expect(result.created).toBe(1);
      expect(result.conflict).toBe(3);
    });
  });
});
