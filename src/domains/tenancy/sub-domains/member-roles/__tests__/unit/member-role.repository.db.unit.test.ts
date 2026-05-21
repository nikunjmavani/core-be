import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import {
  createRoleWithPermissions,
  seedPermissions,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { MemberRoleRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role.repository.js';

describe('MemberRoleRepository (database)', () => {
  const repository = new MemberRoleRepository();

  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions(['organization:read', 'organization:manage']);
  });

  it('paginates an empty organization role list', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const emptyPage = await repository.findByOrganizationId(organization.id, 1, 20);
    expect(emptyPage.items).toEqual([]);
    expect(emptyPage.total).toBe(0);
  });

  it('finds roles by organization and public id', async () => {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ['organization:read'],
    });

    const page = await repository.findByOrganizationId(organization.id, 1, 20);
    expect(page.items.some((row) => row.public_id === role.public_id)).toBe(true);

    const byPublicId = await repository.findByPublicId(role.public_id, organization.id);
    expect(byPublicId?.name).toBe(role.name);

    const created = await repository.create({
      organization_id: organization.id,
      name: 'Editor',
      description: 'Editor role',
      is_system: true,
      created_by_user_id: owner.id,
    });
    expect(created.name).toBe('Editor');
    expect(created.is_system).toBe(true);

    const systemRole = await repository.create({
      organization_id: organization.id,
      name: 'System',
      created_by_user_id: null,
    });
    expect(systemRole.name).toBe('System');

    const defaultRole = await repository.create({
      organization_id: organization.id,
      name: 'Default',
    });
    expect(defaultRole.is_system).toBe(false);

    const explicitNullDescription = await repository.create({
      organization_id: organization.id,
      name: 'Explicit null description',
      description: null,
    });
    expect(explicitNullDescription.description).toBeNull();

    const updated = await repository.update(
      created.public_id,
      organization.id,
      { name: 'Editor Plus', description: 'Updated description' },
      owner.id,
    );
    expect(updated?.name).toBe('Editor Plus');

    const updatedWithNullUpdater = await repository.update(
      created.public_id,
      organization.id,
      { description: 'No updater' },
      null,
    );
    expect(updatedWithNullUpdater?.description).toBe('No updater');

    const deleted = await repository.softDelete(created.public_id, organization.id);
    expect(deleted?.deleted_at).not.toBeNull();
    expect(await repository.softDelete(created.public_id, organization.id)).toBeNull();
    expect(await repository.findByPublicId(created.public_id, organization.id)).toBeNull();
    expect(await repository.findByPublicId('missing_role', organization.id)).toBeNull();
    expect(
      await repository.update('missing_role', organization.id, { name: 'X' }, owner.id),
    ).toBeNull();
  });
});
