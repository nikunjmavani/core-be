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
import { organizationHeaders } from '@/tests/helpers/test-organization.js';
import type { FastifyInstance } from 'fastify';
import type { TestRequestAgent } from '@/tests/helpers/test-app.js';

const TENANCY_READ_PERMISSIONS = [
  TENANCY_PERMISSIONS.ORGANIZATION_READ,
  TENANCY_PERMISSIONS.MEMBERSHIP_READ,
];

/**
 * Cross-tenant isolation — users must not access another organization's resources.
 */
describe('Security: Tenant isolation', () => {
  let app: FastifyInstance;
  let request: TestRequestAgent;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    request = testApp.request;
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

    const response = await request
      .get(`/api/v1/tenancy/organizations/${orgB.organization.public_id}/settings`)
      .set('Authorization', `Bearer ${orgA.token}`)
      .set(organizationHeaders(orgB.organization.public_id));

    expect(response.status).toBe(403);
  });

  it('should return 403 when listing memberships of another organization', async () => {
    const orgA = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);
    const orgB = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);

    const response = await request
      .get(`/api/v1/tenancy/organizations/${orgB.organization.public_id}/memberships`)
      .set('Authorization', `Bearer ${orgA.token}`);

    expect(response.status).toBe(403);
  });

  it('should return 403 when reading webhooks of another organization', async () => {
    const orgA = await createOrganizationWithMember([NOTIFY_PERMISSIONS.WEBHOOK_READ]);
    const orgB = await createOrganizationWithMember([NOTIFY_PERMISSIONS.WEBHOOK_READ]);

    const response = await request
      .get(`/api/v1/notify/organizations/${orgB.organization.public_id}/webhooks`)
      .set('Authorization', `Bearer ${orgA.token}`)
      .set(organizationHeaders(orgB.organization.public_id));

    expect(response.status).toBe(403);
  });

  it('should allow access to own organization settings with membership', async () => {
    const { organization, token } = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);

    const response = await request
      .get(`/api/v1/tenancy/organizations/${organization.public_id}/settings`)
      .set('Authorization', `Bearer ${token}`)
      .set(organizationHeaders(organization.public_id));

    expect([200, 404]).toContain(response.status);
  });

  it('should return 403 for user with no membership on any organization-scoped route', async () => {
    const { organization } = await createOrganizationWithMember(TENANCY_READ_PERMISSIONS);
    const outsider = await createTestUser({ email: 'outsider-cross-tenant@test.com' });
    const outsiderToken = await generateTestToken({ userId: outsider.public_id });

    const response = await request
      .get(`/api/v1/tenancy/organizations/${organization.public_id}/settings`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });
});
