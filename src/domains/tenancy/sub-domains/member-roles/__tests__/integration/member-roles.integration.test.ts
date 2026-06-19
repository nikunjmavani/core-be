import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  injectAuthenticated,
  injectAuthenticatedOrganizationMutation,
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
import {
  provisionPersonalOrganization,
  provisionOrganizationWithOwner,
} from '@/domains/tenancy/sub-domains/organization/organization-provisioning.js';
import { roles } from '@/domains/tenancy/sub-domains/member-roles/member-role.schema.js';
import { database } from '@/infrastructure/database/connection.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import enErrors from '@/shared/locales/en/errors.json' with { type: 'json' };
import type { FastifyInstance } from 'fastify';

const ROLE_PERMISSIONS = [
  TENANCY_PERMISSIONS.ROLE_READ,
  TENANCY_PERMISSIONS.ROLE_MANAGE,
  TENANCY_PERMISSIONS.ORGANIZATION_READ,
];

describe('Member Roles Sub-Domain — Integration', () => {
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
    await seedPermissions(ROLE_PERMISSIONS);
  });

  async function createAuthorizedContext(permissionCodes = ROLE_PERMISSIONS) {
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
    return { organization, role, token };
  }

  describe('GET /api/v1/tenancy/organization/roles', () => {
    it('should return 403 without role read permission', async () => {
      const { organization } = await createAuthorizedContext([
        TENANCY_PERMISSIONS.ORGANIZATION_READ,
      ]);
      const user = await createTestUser({ email: 'norole@test.com' });
      const token = await generateTestToken({
        userId: user.public_id,
        organizationPublicId: organization.public_id,
      });
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organization/roles'),
        token,
      });
      expect(response.statusCode).toBe(403);
    });

    it('should return roles with permission', async () => {
      const { token } = await createAuthorizedContext();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organization/roles'),
        token,
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe('PUT /api/v1/tenancy/organization/roles/:role_id/permissions', () => {
    it('should replace role permissions', async () => {
      const { organization, token } = await createAuthorizedContext();
      const targetRole = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: [TENANCY_PERMISSIONS.ROLE_READ],
      });
      const response = await injectAuthenticated(app, {
        method: 'PUT',
        url: testApiPath(`/tenancy/organization/roles/${targetRole.public_id}/permissions`),
        token,
        payload: { permission_codes: [TENANCY_PERMISSIONS.ORGANIZATION_READ] },
      });
      expect([200, 204]).toContain(response.statusCode);
    });
  });

  // A PERSONAL organization is single-member by definition, so custom roles (which exist to
  // grant scoped permissions to OTHER members) are meaningless there. The service rejects role
  // creation with a 409 ConflictError. This is unit-tested in member-role.service.unit.test.ts;
  // these tests prove the rejection survives over real HTTP — the owner holds ROLE_MANAGE (the
  // full tenancy set, via provisioning), so the request passes RBAC and lands on the no-roles
  // guard rather than a 403.
  describe('PERSONAL organization no-custom-roles guard (HTTP-level coverage)', () => {
    // provisionPersonalOrganization / provisionOrganizationWithOwner insert a role_permissions
    // row per tenancy code (FK → permissions.code, ON DELETE RESTRICT), so every code must exist
    // before provisioning — the suite-level beforeEach only seeds the role subset.
    async function seedAllTenancyPermissions() {
      await seedPermissions(Object.values(TENANCY_PERMISSIONS));
    }

    async function countRoles(organizationId: number): Promise<number> {
      const [row] = await database
        .select({ value: count() })
        .from(roles)
        .where(and(eq(roles.organization_id, organizationId), isNull(roles.deleted_at)));
      return row?.value ?? 0;
    }

    it('rejects POST /roles on a PERSONAL org with 422 (errors:personalOrganizationNoRoles) and creates no role', async () => {
      await seedAllTenancyPermissions();
      const owner = await createTestUser();
      const provisioned = await provisionPersonalOrganization(owner.id);
      const token = await generateTestToken({
        userId: owner.public_id,
        organizationPublicId: provisioned.organization.public_id,
      });

      const rolesBefore = await countRoles(provisioned.organization.id);
      expect(rolesBefore).toBe(1); // only the system Owner role

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organization/roles'),
        token,
        organizationPublicId: provisioned.organization.public_id,
        // POST /roles is idempotencyRequired; send a key so the request reaches the
        // personal-org guard rather than the earlier missing-key 422.
        headers: { 'x-idempotency-key': `idem-${randomUUID()}` },
        payload: { name: `Personal Custom Role ${randomUUID()}` },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json() as { error?: { code?: string; detail?: string } };
      expect(body.error?.code).toBe('unprocessable_entity');
      // The standard test app does not initialize i18next resources, so the wire `detail` is the
      // raw key; a sibling test that initialized i18next first (same worker) yields the English
      // string. Accept either — 422 + `code: 'unprocessable_entity'` + this key uniquely identify the guard.
      expect([
        'errors:personalOrganizationNoRoles',
        enErrors.personalOrganizationNoRoles,
      ]).toContain(body.error?.detail);

      // No custom role was added — only the provisioned system Owner role remains.
      const rolesAfter = await countRoles(provisioned.organization.id);
      expect(rolesAfter).toBe(1);
    });

    it('positive contrast: the SAME POST /roles succeeds (201) on a TEAM org — the guard is type-specific, not a blanket block', async () => {
      await seedAllTenancyPermissions();
      const owner = await createTestUser();
      const team = await provisionOrganizationWithOwner({
        name: 'Role-Guard Contrast Team',
        slug: `rg-contrast-${generatePublicId('organization').slice(4, 14)}`,
        type: 'TEAM',
        ownerUserId: owner.id,
      });
      const token = await generateTestToken({
        userId: owner.public_id,
        organizationPublicId: team.organization.public_id,
      });

      const rolesBefore = await countRoles(team.organization.id);

      const response = await injectAuthenticatedOrganizationMutation(app, {
        method: 'POST',
        url: testApiPath('/tenancy/organization/roles'),
        token,
        organizationPublicId: team.organization.public_id,
        headers: { 'x-idempotency-key': `idem-${randomUUID()}` },
        payload: { name: `Team Custom Role ${randomUUID()}` },
      });

      expect(response.statusCode).toBe(201);
      const rolesAfter = await countRoles(team.organization.id);
      expect(rolesAfter).toBe(rolesBefore + 1);
    });
  });
});
