import { randomUUID } from 'node:crypto';
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
    const token = await generateTestToken({ userId: user.public_id });
    return { user, organization, role, token };
  }

  function notificationPoliciesCollectionPath(organizationPublicId: string) {
    return `/api/v1/tenancy/organizations/${organizationPublicId}/notification-policies`;
  }

  function notificationPolicyResourcePath(organizationPublicId: string, policyId: number | string) {
    return `/api/v1/tenancy/organizations/${organizationPublicId}/notification-policies/${policyId}`;
  }

  describe('GET /api/v1/tenancy/organizations/:id/notification-policies', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: notificationPoliciesCollectionPath('unauthenticated-organization-route'),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy read permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return notification policies with read permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: unknown };
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('GET /api/v1/tenancy/organizations/:id/notification-policies/:policyId', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        url: notificationPolicyResourcePath('unauthenticated-organization-route', 1),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy read permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath(organization.public_id, 1),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 when policy id is not a positive integer', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath(organization.public_id, 'not-an-integer'),
        token,
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 404 when notification policy does not exist', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath(organization.public_id, 999_999),
        token,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should return notification policy by numeric id', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: { notification_type: 'IN_APP', channel: 'EMAIL', default_enabled: true },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: number } };
      const policyId = createdBody.data.id;

      const response = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath(organization.public_id, policyId),
        token,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { data: { id: number; notification_type: string } };
      expect(body.data).toHaveProperty('id', policyId);
      expect(body.data).toHaveProperty('notification_type', 'IN_APP');
    });
  });

  describe('POST /api/v1/tenancy/organizations/:id/notification-policies', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath('unauthenticated-organization-route'),
        payload: { notification_type: 'TYPE', channel: 'EMAIL' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy manage permission', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: { notification_type: 'IN_APP', channel: 'EMAIL' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 when notification_type is missing', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: { channel: 'EMAIL' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 when channel is missing', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: { notification_type: 'IN_APP' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 422 (not 500) when channel is outside the allowed set', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      // An unknown channel must be rejected by the DTO, not slip through to the
      // chk_org_notif_channel database check and surface as a 500.
      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: { notification_type: 'IN_APP', channel: 'CARRIER_PIGEON' },
      });
      expect([400, 422]).toContain(response.statusCode);
      expect(response.statusCode).toBeLessThan(500);
    });

    it('should return 400 when body contains unknown keys', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: {
          notification_type: 'IN_APP',
          channel: 'EMAIL',
          extra_field: true,
        },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 when muted_until is not a datetime string', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: {
          notification_type: 'IN_APP',
          channel: 'EMAIL',
          muted_until: 'not-a-valid-datetime',
        },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should create notification policy when manage permission is granted', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: {
          notification_type: 'BILLING',
          channel: 'PUSH',
          default_enabled: false,
          is_mandatory: false,
          muted_until: null,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { data: { notification_type: string; channel: string } };
      expect(body.data).toHaveProperty('notification_type', 'BILLING');
      expect(body.data).toHaveProperty('channel', 'PUSH');
    });
  });

  describe('PATCH /api/v1/tenancy/organizations/:id/notification-policies/:policyId', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath('unauthenticated-organization-route', 1),
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
        url: notificationPoliciesCollectionPath(manageContext.organization.public_id),
        token: manageContext.token,
        payload: { notification_type: 'SECURITY', channel: 'EMAIL' },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: number } };
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
      const readOnlyToken = await generateTestToken({ userId: readOnlyUser.public_id });

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath(manageContext.organization.public_id, policyId),
        token: readOnlyToken,
        payload: { default_enabled: false },
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 400 when body contains unknown keys', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: { notification_type: 'UPDATE_TEST', channel: 'EMAIL' },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: number } };
      const policyId = createdBody.data.id;

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath(organization.public_id, policyId),
        token,
        payload: { default_enabled: true, unexpected: true },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should return 400 when muted_until on update is not a datetime string', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: { notification_type: 'MUTED_TEST', channel: 'SMS' },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: number } };
      const policyId = createdBody.data.id;

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath(organization.public_id, policyId),
        token,
        payload: { muted_until: 'invalid-datetime-value' },
      });
      expect([400, 422]).toContain(response.statusCode);
    });

    it('should update notification policy when manage permission is granted', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: {
          notification_type: 'ORIGINAL_POLICY',
          channel: 'IN_APP',
          default_enabled: true,
          is_mandatory: false,
        },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: number } };
      const policyId = createdBody.data.id;

      const patched = await injectAuthenticatedOrganizationMutation(app, {
        method: 'PATCH',
        url: notificationPolicyResourcePath(organization.public_id, policyId),
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

  describe('DELETE /api/v1/tenancy/organizations/:id/notification-policies/:policyId', () => {
    it('should return 401 without authentication', async () => {
      const response = await injectUnauthenticated(app, {
        method: 'DELETE',
        url: notificationPolicyResourcePath('unauthenticated-organization-route', 1),
      });
      expect(response.statusCode).toBe(401);
    });

    it('should return 403 without notification policy manage permission', async () => {
      const manageContext = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);
      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(manageContext.organization.public_id),
        token: manageContext.token,
        payload: { notification_type: 'DELETE_GUARD', channel: 'EMAIL' },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: number } };
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
      const readOnlyToken = await generateTestToken({ userId: readOnlyUser.public_id });

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: notificationPolicyResourcePath(manageContext.organization.public_id, policyId),
        token: readOnlyToken,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return 404 when notification policy does not exist', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: notificationPolicyResourcePath(organization.public_id, 888_888),
        token,
      });
      expect(response.statusCode).toBe(404);
    });

    it('should delete notification policy when manage permission is granted', async () => {
      const { organization, token } = await createAuthorizedOrganizationContext([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE,
      ]);

      const created = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: notificationPoliciesCollectionPath(organization.public_id),
        token,
        payload: {
          notification_type: `TEMPORARY_POLICY_${randomUUID().slice(0, 8)}`,
          channel: 'IN_APP',
        },
      });
      expect(created.statusCode).toBe(201);
      const createdBody = created.json() as { data: { id: number } };
      const policyId = createdBody.data.id;
      expect(policyId).toBeGreaterThan(0);

      const deleted = await injectAuthenticatedOrganizationMutation(app, {
        method: 'DELETE',
        url: notificationPolicyResourcePath(organization.public_id, policyId),
        token,
      });
      expect(deleted.statusCode).toBe(204);

      const lookup = await injectAuthenticated(app, {
        url: notificationPolicyResourcePath(organization.public_id, policyId),
        token,
      });
      expect(lookup.statusCode).toBe(404);
    });
  });
});
