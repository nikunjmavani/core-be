import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import {
  createMembership,
  createRoleWithPermissions,
  seedPermissions,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { PermissionRepository } from '@/domains/tenancy/sub-domains/permission/permission.repository.js';

describe('PermissionRepository (database)', () => {
  const repository = new PermissionRepository();

  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions(['organization:read', 'organization:manage']);
  });

  it('lists permissions and resolves user organization permission codes', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ['organization:read', 'organization:manage'],
    });
    await createMembership({
      userId: owner.id,
      organizationId: organization.id,
      roleId: role.id,
      status: 'ACTIVE',
    });

    const allPermissions = await repository.findAll();
    expect(allPermissions.some((row) => row.code === 'organization:read')).toBe(true);

    const orderedCodes = allPermissions.map((row) => `${row.category}/${row.code}`);
    expect(orderedCodes).toEqual([...orderedCodes].sort());

    const codes = await repository.findPermissionCodesForUserInOrganization(
      owner.public_id,
      organization.public_id,
    );
    expect(codes.sort()).toEqual(['organization:manage', 'organization:read']);
  });
});
