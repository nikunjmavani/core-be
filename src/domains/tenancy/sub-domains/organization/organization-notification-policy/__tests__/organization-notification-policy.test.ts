import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
  injectUnauthenticated,
} from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import {
  seedPermissions,
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import type { FastifyInstance } from 'fastify';

const TENANCY_PERMISSION_CODES = Object.values(TENANCY_PERMISSIONS);

describe('Tenancy Organization Notification Policy Sub-Domain — Integration', () => {
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
    await seedPermissions(TENANCY_PERMISSION_CODES);
  });

  async function createAuthorizedOrganizationContext(permissionCodes: string[]) {
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
    // Flat tenancy routes resolve the organization from the JWT `org` claim.
    const token = await generateTestToken({
      userId: user.public_id,
      organizationPublicId: organization.public_id,
    });
    return { user, organization, role, token };
  }

  const NOTIFICATION_POLICIES_COLLECTION_PATH =
    '/api/v1/tenancy/organization/notification-policies';

  function notificationPolicyResourcePath(policyId: string) {
    return `/api/v1/tenancy/organization/notification-policies/${policyId}`;
  }

  describe('GET /api/v1/tenancy/organization/notification-policies', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy read permission', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return notification policies with read permission', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown };
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/tenancy/organization/notification-policies/:notification_policy_id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: notificationPolicyResourcePath('pol_unauth0000000000_'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy read permission', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath('pol_arbitrary000000000000'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    // sec-T5: route validates the policyId as a 21-char public id now.
    it('should return 400 when policy id is not a valid public id', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath('not-a-public-id'),
        token,
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 404 when notification policy does not exist', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        // sec-T5: 21-char-ish well-formed public id that no row carries.
        url: notificationPolicyResourcePath('pol_doesnotexist000000000'),
        token,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should return notification policy by public id (sec-T5)', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: { notification_type: 'system.welcome', channel: 'EMAIL', default_enabled: true },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: string } };
      const policyId = createdBody.data.id;

      const response = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath(policyId),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { id: string; notification_type: string } };
      expect(body.data).toHaveProperty('id', policyId);
      expect(typeof body.data.id).toBe('string'); // sec-T5: public id (not bigserial)
      expect(body.data).toHaveProperty('notification_type', 'system.welcome');
    });
  });

  describe('POST /api/v1/tenancy/organization/notification-policies', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        payload: { notification_type: 'system.maintenance', channel: 'EMAIL' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy manage permission', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: { notification_type: 'system.welcome', channel: 'EMAIL' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 when notification_type is missing', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: { channel: 'EMAIL' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 when channel is missing', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: { notification_type: 'system.welcome' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 422 (not 500) when channel is outside the allowed set', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      // An unknown channel must be rejected by the DTO, not slip through to the
      // chk_org_notif_channel database check and surface as a 500.
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: { notification_type: 'system.welcome', channel: 'CARRIER_PIGEON' },
      });
      expect([400, 422]).toContain(response.statusCode);
      expect(response.statusCode).toBeLessThan(500);
    });

    it('should return 400 when body contains unknown keys', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: {
          notification_type: 'system.welcome',
          channel: 'EMAIL',
          extra_field: true,
        },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 when muted_until is not a datetime string', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: {
          notification_type: 'system.welcome',
          channel: 'EMAIL',
          muted_until: 'not-a-valid-datetime',
        },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should create notification policy when manage permission is granted', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: {
          notification_type: 'billing.usage_threshold',
          channel: 'PUSH',
          default_enabled: false,
          is_mandatory: false,
          muted_until: null,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { data: { notification_type: string; channel: string } };
      expect(body.data).toHaveProperty('notification_type', 'billing.usage_threshold');
      expect(body.data).toHaveProperty('channel', 'PUSH');
    });
  });

  describe('PATCH /api/v1/tenancy/organization/notification-policies/:notification_policy_id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath('pol_unauth0000000000_'),
        payload: { default_enabled: false },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy manage permission', async () => {
      const manageContext = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);
      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token: manageContext.token,
        payload: { notification_type: 'security.alert', channel: 'EMAIL' },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: string } };
      const policyId = createdBody.data.id;

      const readOnlyUser = await createTestUser({
        email: 'notification-policy-read-patch@test.com',
      });
      const readOnlyRole = await createRoleWithPermissions({
        organizationId: manageContext.organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ],
      });
      await createMembership({
        userId: readOnlyUser.id,
        organizationId: manageContext.organization.id,
        roleId: readOnlyRole.id,
      });
      const readOnlyToken = await generateTestToken({
        userId: readOnlyUser.public_id,
        organizationPublicId: manageContext.organization.public_id,
      });

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath(policyId),
        token: readOnlyToken,
        payload: { default_enabled: false },
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 when body contains unknown keys', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: { notification_type: 'subscription.updated', channel: 'EMAIL' },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: string } };
      const policyId = createdBody.data.id;

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath(policyId),
        token,
        payload: { default_enabled: true, unexpected: true },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 when muted_until on update is not a datetime string', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: { notification_type: 'billing.payment_failed', channel: 'SMS' },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: string } };
      const policyId = createdBody.data.id;

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath(policyId),
        token,
        payload: { muted_until: 'invalid-datetime-value' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should update notification policy when manage permission is granted', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: {
          notification_type: 'membership.invite_accepted',
          channel: 'IN_APP',
          default_enabled: true,
          is_mandatory: false,
        },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: string } };
      const policyId = createdBody.data.id;

      const patched = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath(policyId),
        token,
        payload: {
          default_enabled: false,
          is_mandatory: true,
        },
      });
      expect(patched.statusCode).toBe(200);
      const patchedBody = patched.json() as {
        data: { default_enabled: boolean; is_mandatory: boolean };
      };
      expect(patchedBody.data.default_enabled).toBe(false);
      expect(patchedBody.data.is_mandatory).toBe(true);
    });
  });

  describe('DELETE /api/v1/tenancy/organization/notification-policies/:notification_policy_id', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: notificationPolicyResourcePath('pol_unauth0000000000_'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy manage permission', async () => {
      const manageContext = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);
      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token: manageContext.token,
        payload: { notification_type: 'webhook.delivery_failed', channel: 'EMAIL' },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: string } };
      const policyId = createdBody.data.id;

      const readOnlyUser = await createTestUser({
        email: 'notification-policy-read-delete@test.com',
      });
      const readOnlyRole = await createRoleWithPermissions({
        organizationId: manageContext.organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ],
      });
      await createMembership({
        userId: readOnlyUser.id,
        organizationId: manageContext.organization.id,
        roleId: readOnlyRole.id,
      });
      const readOnlyToken = await generateTestToken({
        userId: readOnlyUser.public_id,
        organizationPublicId: manageContext.organization.public_id,
      });

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: notificationPolicyResourcePath(policyId),
        token: readOnlyToken,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 404 when notification policy does not exist', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: notificationPolicyResourcePath('pol_doesnotexist000000000'),
        token,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should delete notification policy when manage permission is granted', async () => {
      const { token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: NOTIFICATION_POLICIES_COLLECTION_PATH,
        token,
        payload: {
          notification_type: 'membership.invite_accepted',
          channel: 'IN_APP',
        },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: string } };
      const policyId = createdBody.data.id;
      // sec-T5: policy id is now a 21-char public id (string), not the
      // bigserial row id.
      expect(typeof policyId).toBe('string');
      expect(policyId.length).toBeGreaterThan(0);

      const deleted = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: notificationPolicyResourcePath(policyId),
        token,
      });
      expect(deleted.statusCode).toBe(204);

      const lookup = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath(policyId),
        token,
      });
      expect(lookup.statusCode).toBe(404);
    });
  });
});
