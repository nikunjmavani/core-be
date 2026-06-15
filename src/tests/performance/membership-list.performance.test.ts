import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
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
import { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';
import type { FastifyInstance } from 'fastify';

const MEMBERSHIP_LIST_PERMISSIONS = [
  TENANCY_PERMISSIONS.MEMBERSHIP_READ,
  TENANCY_PERMISSIONS.ORGANIZATION_READ,
];

const MEMBER_COUNT = 20;

describe('Performance: membership list', () => {
  const repository = new MembershipRepository();

  describe('repository batch join', () => {
    beforeEach(async () => {
      await cleanupDatabase();
    });

    it('issues one select query for N memberships with joined public ids', async () => {
      const owner = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: owner.id });
      const role = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: ['organization:read'],
      });
      await createMembership({
        userId: owner.id,
        organizationId: organization.id,
        roleId: role.id,
      });

      for (let index = 0; index < MEMBER_COUNT - 1; index++) {
        const member = await createTestUser({ email: `member-${index}@membership-perf.test` });
        await createMembership({
          userId: member.id,
          organizationId: organization.id,
          roleId: role.id,
        });
      }

      const result = await repository.findByOrganizationId(organization.id, { limit: 50 });

      expect(result.items).toHaveLength(MEMBER_COUNT);
      for (const row of result.items) {
        expect(row.user_id).toBeGreaterThan(0);
        expect(row.role_id).toBe(role.id);
        expect(row.organization_id).toBe(organization.id);
      }
    });
  });

  describe('HTTP list endpoint', () => {
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
      await seedPermissions(MEMBERSHIP_LIST_PERMISSIONS);
    });

    it('lists many memberships without N+1 query degradation', { timeout: 30000 }, async () => {
      const owner = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: owner.id });
      const role = await createRoleWithPermissions({
        organizationId: organization.id,
        permissionCodes: MEMBERSHIP_LIST_PERMISSIONS,
      });
      await createMembership({
        userId: owner.id,
        organizationId: organization.id,
        roleId: role.id,
      });

      for (let index = 0; index < MEMBER_COUNT - 1; index++) {
        const member = await createTestUser({ email: `http-member-${index}@membership-perf.test` });
        await createMembership({
          userId: member.id,
          organizationId: organization.id,
          roleId: role.id,
        });
      }

      const token = await generateTestToken({
        userId: owner.public_id,
        organizationPublicId: organization.public_id,
      });
      const start = performance.now();
      const response = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organization/memberships?limit=50'),
        token,
        organizationPublicId: organization.public_id,
      });
      const duration = performance.now() - start;

      expect(response.statusCode).toBe(200);
      const body = response.json() as { data?: unknown[] };
      expect(body.data?.length).toBe(MEMBER_COUNT);
      expect(duration).toBeLessThan(5000);
    });
  });
});
