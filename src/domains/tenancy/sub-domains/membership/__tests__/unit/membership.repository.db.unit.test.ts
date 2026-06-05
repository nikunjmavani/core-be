import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import {
  createMembership,
  createRoleWithPermissions,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';

describe('MembershipRepository (database)', () => {
  const repository = new MembershipRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('creates and queries memberships by organization and user', async () => {
    const owner = await createTestUser();
    const member = await createTestUser({ email: 'member-db@test.com' });
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ['organization:read'],
    });
    const membership = await createMembership({
      userId: member.id,
      organizationId: organization.id,
      roleId: role.id,
    });

    const page = await repository.findByOrganizationId(organization.id, { limit: 20 });
    expect(page.items.some((row) => row.public_id === membership.public_id)).toBe(true);

    const byPublicId = await repository.findByPublicId(membership.public_id, organization.id);
    expect(byPublicId?.user_id).toBe(member.id);

    const byUser = await repository.findByUserAndOrganization(member.id, organization.id);
    expect(byUser?.public_id).toBe(membership.public_id);

    const byId = await repository.findById(membership.id);
    expect(byId?.public_id).toBe(membership.public_id);

    const updated = await repository.update(
      membership.public_id,
      organization.id,
      { status: 'ACTIVE' },
      owner.id,
    );
    expect(updated?.status).toBe('ACTIVE');
    expect(updated?.joined_at).not.toBeNull();

    const deleted = await repository.softDelete(membership.public_id, organization.id);
    expect(deleted?.deleted_at).not.toBeNull();

    const afterDelete = await repository.findByPublicId(membership.public_id, organization.id);
    expect(afterDelete).toBeNull();
  });

  it('returns null for missing memberships and supports non-active updates', async () => {
    const owner = await createTestUser({ email: 'owner-missing@example.com' });
    const invitee = await createTestUser({ email: 'invitee-missing@example.com' });
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: ['organization:read'],
    });
    const membership = await createMembership({
      userId: owner.id,
      organizationId: organization.id,
      roleId: role.id,
      status: 'INVITED',
    });

    expect(await repository.findById(99_999)).toBeNull();
    expect(await repository.findByPublicId('missing_public_id', organization.id)).toBeNull();
    expect(await repository.findByUserAndOrganization(owner.id, 99_999)).toBeNull();

    const invited = await repository.create({
      organization_id: organization.id,
      user_id: invitee.id,
      role_id: role.id,
    });
    expect(invited.status).toBe('INVITED');

    const suspended = await repository.update(
      membership.public_id,
      organization.id,
      { status: 'SUSPENDED' },
      owner.id,
    );
    expect(suspended?.status).toBe('SUSPENDED');

    const activated = await repository.update(
      invited.public_id,
      organization.id,
      { status: 'ACTIVE' },
      owner.id,
    );
    expect(activated?.status).toBe('ACTIVE');
    expect(activated?.joined_at).not.toBeNull();

    const withoutStatus = await repository.update(invited.public_id, organization.id, {}, null);
    expect(withoutStatus?.status).toBe('ACTIVE');

    expect(
      await repository.update(
        'missing_membership',
        organization.id,
        { status: 'ACTIVE' },
        owner.id,
      ),
    ).toBeNull();
    expect(await repository.softDelete('missing_membership', organization.id)).toBeNull();
  });

  it('softDelete refuses to remove the organization owner (atomic owner-guard)', async () => {
    const owner = await createTestUser({ email: 'owner-guard@test.com' });
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: [],
    });
    const ownerMembership = await createMembership({
      userId: owner.id,
      organizationId: organization.id,
      roleId: role.id,
    });
    const member = await createTestUser({ email: 'regular-guard@test.com' });
    const memberMembership = await createMembership({
      userId: member.id,
      organizationId: organization.id,
      roleId: role.id,
    });

    // Removing the owner's membership would orphan the organization — the guard blocks it.
    expect(await repository.softDelete(ownerMembership.public_id, organization.id)).toBeNull();
    const ownerStillActive = await repository.findByPublicId(
      ownerMembership.public_id,
      organization.id,
    );
    expect(ownerStillActive?.deleted_at).toBeNull();

    // A non-owner member is removed normally.
    const deleted = await repository.softDelete(memberMembership.public_id, organization.id);
    expect(deleted?.public_id).toBe(memberMembership.public_id);
  });
});
