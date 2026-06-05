import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/errors/index.js';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

vi.mock('@/domains/tenancy/sub-domains/permission/permission-cache.service.js', () => ({
  invalidateOrganizationPermissions: vi.fn().mockResolvedValue(undefined),
}));

import { MemberRoleService } from '@/domains/tenancy/sub-domains/member-roles/member-role.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { MemberRoleRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role.repository.js';
import type { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';
import { invalidateOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';

/**
 * Regression for sec-T3 (High): role-delete must refuse to silently strip every member
 * holding the role.
 *
 * Two guards added in this PR:
 *   1. `is_system` guard — system roles (Admin, Member seeds) cannot be deleted.
 *      Previously the route's OpenAPI doc claimed this but the implementation didn't
 *      enforce it; combined with `createMemberRoleDto` accepting `is_system: true`
 *      from the client, tenants could even create roles indistinguishable from seeds.
 *   2. Active-membership guard — a role currently assigned to N active memberships
 *      cannot be deleted (clients must reassign members first). Previously, soft-
 *      deleting a role silently stripped every member's permission set because the
 *      permission-resolution join filters `isNull(roles.deleted_at)`.
 *
 * The first guard fires before the second so the error message is the most actionable
 * one available (operators see "system role" before "members assigned").
 */
describe('MemberRoleService.delete — sec-T3 guards', () => {
  const organization = { id: 1, public_id: 'org_public', owner_user_id: 99 };

  const systemRole = {
    id: 7,
    public_id: 'role_system',
    name: 'Admin',
    organization_id: organization.id,
    is_system: true,
    deleted_at: null,
  };

  const customRoleAssigned = {
    id: 8,
    public_id: 'role_custom_assigned',
    name: 'People-Ops',
    organization_id: organization.id,
    is_system: false,
    deleted_at: null,
  };

  const customRoleEmpty = {
    id: 9,
    public_id: 'role_custom_empty',
    name: 'Unused',
    organization_id: organization.id,
    is_system: false,
    deleted_at: null,
  };

  const organizationService = {
    requireOrganizationMembershipByPublicId: vi.fn().mockResolvedValue(organization),
  } as unknown as OrganizationService;

  const memberRoleRepository = {
    findByPublicId: vi.fn(),
    softDelete: vi.fn(),
  } as unknown as MemberRoleRepository;

  const membershipRepository = {
    countActiveByRoleId: vi.fn(),
  } as unknown as MembershipRepository;

  const service = new MemberRoleService(
    organizationService,
    memberRoleRepository,
    membershipRepository,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockResolvedValue(
      organization as never,
    );
    vi.mocked(memberRoleRepository.softDelete).mockImplementation(
      async (publicId) => ({ public_id: publicId, organization_id: organization.id }) as never,
    );
  });

  it('refuses to delete a system role with ForbiddenError (is_system guard fires first)', async () => {
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue(systemRole as never);

    await expect(service.delete('org_public', systemRole.public_id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );

    expect(memberRoleRepository.softDelete).not.toHaveBeenCalled();
    expect(invalidateOrganizationPermissions).not.toHaveBeenCalled();
  });

  it('refuses to delete a non-system role that has active members (ConflictError)', async () => {
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue(customRoleAssigned as never);
    vi.mocked(membershipRepository.countActiveByRoleId).mockResolvedValue(3);

    await expect(service.delete('org_public', customRoleAssigned.public_id)).rejects.toBeInstanceOf(
      ConflictError,
    );

    expect(memberRoleRepository.softDelete).not.toHaveBeenCalled();
    expect(invalidateOrganizationPermissions).not.toHaveBeenCalled();
  });

  it('allows deletion of an unused non-system role (control case — happy path)', async () => {
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue(customRoleEmpty as never);
    vi.mocked(membershipRepository.countActiveByRoleId).mockResolvedValue(0);

    await expect(service.delete('org_public', customRoleEmpty.public_id)).resolves.toBeUndefined();

    expect(memberRoleRepository.softDelete).toHaveBeenCalledWith(
      customRoleEmpty.public_id,
      organization.id,
    );
    expect(invalidateOrganizationPermissions).toHaveBeenCalledWith('org_public');
  });

  it('throws NotFoundError when the role does not exist (membership count is skipped)', async () => {
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue(null);

    await expect(service.delete('org_public', 'role_missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(membershipRepository.countActiveByRoleId).not.toHaveBeenCalled();
    expect(memberRoleRepository.softDelete).not.toHaveBeenCalled();
  });
});
