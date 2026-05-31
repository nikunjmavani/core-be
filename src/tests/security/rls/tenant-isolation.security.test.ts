import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
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
import { NOTIFY_PERMISSIONS } from '@/domains/notify/notify.permissions.js';
import {
  seedTwoOrganizationsWithSubscriptions,
  seedUploadForOrganization,
} from '@/tests/helpers/test-organization.js';
import { BILLING_PERMISSIONS } from '@/domains/billing/billing.permissions.js';
import { database } from '@/infrastructure/database/connection.js';
import { subscriptions } from '@/domains/billing/sub-domains/subscription/subscription.schema.js';
import { eq } from 'drizzle-orm';
import { uploads } from '@/domains/upload/upload.schema.js';
import { UPLOAD_PURPOSES, UPLOAD_TARGETS } from '@/domains/upload/upload.constants.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import type { FastifyInstance } from 'fastify';

const SUBSCRIPTION_MUTATION_IDEMPOTENCY_KEY = 'tenant-isolation-subscription-mutation-key';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

const TENANCY_READ_PERMISSIONS = [
  TENANCY_PERMISSIONS.ORGANIZATION_READ,
  TENANCY_PERMISSIONS.MEMBERSHIP_READ,
];

/**
 * Cross-tenant isolation — users must not access another organization's resources.
 */
describe('Security: Tenant isolation', () => {
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
    await seedPermissions([
      ...Object.values(TENANCY_PERMISSIONS),
      ...Object.values(NOTIFY_PERMISSIONS),
    ]);
  });

  async function createOrganizationWithMember(permissionCodes: string[]) {
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
    return { user, organization, token };
  }

  it('should return 403 when accessing another organization settings without membership', async () => {
    const orgA = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);
    const orgB = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${orgB.organization.public_id}/settings`),
      token: orgA.token,
      organizationPublicId: orgB.organization.public_id,
    });

    expect(response.statusCode).toBe(403);
  });

  it('should return 403 when listing memberships of another organization', async () => {
    const orgA = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);
    const orgB = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${orgB.organization.public_id}/memberships`),
      token: orgA.token,
    });

    expect(response.statusCode).toBe(403);
  });

  it('should return 403 when reading webhooks of another organization', async () => {
    const orgA = await createOrganizationWithMember([NOTIFY_PERMISSIONS.WEBHOOK_READ]);
    const orgB = await createOrganizationWithMember([NOTIFY_PERMISSIONS.WEBHOOK_READ]);

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/notify/organizations/${orgB.organization.public_id}/webhooks`),
      token: orgA.token,
      organizationPublicId: orgB.organization.public_id,
    });

    expect(response.statusCode).toBe(403);
  });

  it('should allow access to own organization settings with membership', async () => {
    const { organization, token } = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/settings`),
      token,
      organizationPublicId: organization.public_id,
    });

    expect([200, 404]).toContain(response.statusCode);
  });

  it('should return 403 for user with no membership on any organization-scoped route', async () => {
    const { organization } = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);
    const outsider = await createTestUser({ email: 'outsider-cross-tenant@test.com' });
    const outsiderToken = await generateTestToken({ userId: outsider.public_id });

    const response = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${organization.public_id}/settings`),
      token: outsiderToken,
    });

    expect(response.statusCode).toBe(403);
  });

  describe('billing subscriptions (HTTP cross-tenant)', () => {
    beforeEach(async () => {
      await seedPermissions([
        BILLING_PERMISSIONS.SUBSCRIPTION_READ,
        BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE,
      ]);
    });

    it('returns 403 when listing subscriptions for another organization', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/billing/organizations/${fixture.organizationB.public_id}/subscriptions`),
        token: fixture.userA.token,
        organizationPublicId: fixture.organizationB.public_id,
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 403 or 404 when reading a subscription in another organization', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(
          `/billing/organizations/${fixture.organizationB.public_id}/subscriptions/${fixture.subscriptionInB.public_id}`,
        ),
        token: fixture.userA.token,
        organizationPublicId: fixture.organizationB.public_id,
      });

      expect([403, 404]).toContain(response.statusCode);
    });

    it('returns 403 when patching a subscription in another organization', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();

      const response = await injectAuthenticated(app, {
        method: 'PATCH',
        url: testApiPath(
          `/billing/organizations/${fixture.organizationB.public_id}/subscriptions/${fixture.subscriptionInB.public_id}`,
        ),
        token: fixture.userA.token,
        organizationPublicId: fixture.organizationB.public_id,
        payload: { cancel_at_period_end: true },
      });

      expect([403, 400]).toContain(response.statusCode);
      expect(response.statusCode).not.toBe(200);

      const [row] = await database
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(eq(subscriptions.id, fixture.subscriptionInB.id));
      expect(row?.status).toBe(fixture.subscriptionInB.status);
    });

    it('returns 403 when canceling a subscription in another organization', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(
          `/billing/organizations/${fixture.organizationB.public_id}/subscriptions/${fixture.subscriptionInB.public_id}/cancel`,
        ),
        token: fixture.userA.token,
        organizationPublicId: fixture.organizationB.public_id,
        headers: { 'idempotency-key': SUBSCRIPTION_MUTATION_IDEMPOTENCY_KEY },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 403 when changing plan on a subscription in another organization', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(
          `/billing/organizations/${fixture.organizationB.public_id}/subscriptions/${fixture.subscriptionInB.public_id}/change-plan`,
        ),
        token: fixture.userA.token,
        organizationPublicId: fixture.organizationB.public_id,
        headers: { 'idempotency-key': SUBSCRIPTION_MUTATION_IDEMPOTENCY_KEY },
        payload: { plan_id: fixture.plan.public_id },
      });

      expect([403, 400]).toContain(response.statusCode);
      expect(response.statusCode).not.toBe(200);
    });

    it('returns 403 when resuming a subscription in another organization', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(
          `/billing/organizations/${fixture.organizationB.public_id}/subscriptions/${fixture.subscriptionInB.public_id}/resume`,
        ),
        token: fixture.userA.token,
        organizationPublicId: fixture.organizationB.public_id,
        headers: { 'idempotency-key': SUBSCRIPTION_MUTATION_IDEMPOTENCY_KEY },
        payload: {},
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 403 when creating a subscription with mismatched organization header', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath(`/billing/organizations/${fixture.organizationB.public_id}/subscriptions`),
        token: fixture.userA.token,
        organizationPublicId: fixture.organizationA.public_id,
        payload: { plan_id: fixture.plan.public_id, billing_cycle: 'monthly' },
      });

      expect([403, 422]).toContain(response.statusCode);
      expect(response.statusCode).not.toBe(201);
    });
  });

  describe('tenancy org-scoped routes (HTTP cross-tenant)', () => {
    beforeEach(async () => {
      await seedPermissions([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
        TENANCY_PERMISSIONS.API_KEY_READ,
        TENANCY_PERMISSIONS.ROLE_READ,
        NOTIFY_PERMISSIONS.WEBHOOK_READ,
      ]);
    });

    it('returns 403 when listing notification policies of another organization', async () => {
      const orgA = await createOrganizationWithMember([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
      ]);
      const orgB = await createOrganizationWithMember([
        TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ,
      ]);

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(
          `/tenancy/organizations/${orgB.organization.public_id}/notification-policies`,
        ),
        token: orgA.token,
        organizationPublicId: orgB.organization.public_id,
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 403 when listing API keys of another organization', async () => {
      const orgA = await createOrganizationWithMember([TENANCY_PERMISSIONS.API_KEY_READ]);
      const orgB = await createOrganizationWithMember([TENANCY_PERMISSIONS.API_KEY_READ]);

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${orgB.organization.public_id}/api-keys`),
        token: orgA.token,
        organizationPublicId: orgB.organization.public_id,
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 403 when listing roles of another organization', async () => {
      const orgA = await createOrganizationWithMember([TENANCY_PERMISSIONS.ROLE_READ]);
      const orgB = await createOrganizationWithMember([TENANCY_PERMISSIONS.ROLE_READ]);

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/tenancy/organizations/${orgB.organization.public_id}/roles`),
        token: orgA.token,
        organizationPublicId: orgB.organization.public_id,
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 403 when listing webhook events of another organization', async () => {
      const orgA = await createOrganizationWithMember([NOTIFY_PERMISSIONS.WEBHOOK_READ]);
      const orgB = await createOrganizationWithMember([NOTIFY_PERMISSIONS.WEBHOOK_READ]);

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/notify/organizations/${orgB.organization.public_id}/webhook-events`),
        token: orgA.token,
        organizationPublicId: orgB.organization.public_id,
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('uploads (HTTP cross-tenant)', () => {
    it('returns 403 when POST organization upload uses another organization id', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/uploads'),
        token: fixture.userA.token,
        organizationPublicId: fixture.organizationA.public_id,
        payload: {
          purpose: UPLOAD_PURPOSES.ORGANIZATION_FILE,
          for: UPLOAD_TARGETS.ORGANIZATION,
          organizationId: fixture.organizationB.public_id,
          contentType: 'image/png',
          fileName: 'secret.png',
          fileSize: 1024,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 404 when GET targets an upload owned by another user', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();
      const uploadInB = await seedUploadForOrganization({
        userId: fixture.userB.id,
        organizationId: fixture.organizationB.id,
      });

      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath(`/uploads/${uploadInB.public_id}`),
        token: fixture.userA.token,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).not.toMatchObject({
        data: expect.objectContaining({ publicId: uploadInB.public_id }),
      });
    });

    it('returns 404 when DELETE targets an upload owned by another user and row remains', async () => {
      const fixture = await seedTwoOrganizationsWithSubscriptions();
      const uploadInB = await seedUploadForOrganization({
        userId: fixture.userB.id,
        organizationId: fixture.organizationB.id,
      });

      const response = await injectAuthenticated(app, {
        method: 'DELETE',
        url: testApiPath(`/uploads/${uploadInB.public_id}`),
        token: fixture.userA.token,
      });

      expect(response.statusCode).toBe(404);

      const [row] = await database
        .select({ deleted_at: uploads.deleted_at })
        .from(uploads)
        .where(eq(uploads.id, uploadInB.id));
      expect(row?.deleted_at).toBeNull();
    });
  });
});
