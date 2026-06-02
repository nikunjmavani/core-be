import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '@/shared/errors/index.js';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

vi.mock('@/domains/tenancy/sub-domains/permission/permission-cache.service.js', () => ({
  invalidateOrganizationPermissions: vi.fn().mockResolvedValue(undefined),
}));

// The grant-permission guard has its own dedicated unit tests; stub it to a no-op here so these
// tests isolate the service's own control flow, except where we assert it is invoked.
vi.mock('@/domains/tenancy/sub-domains/permission/assert-grantable-permissions.util.js', () => ({
  assertCallerCanGrantPermissionCodes: vi.fn().mockResolvedValue(undefined),
}));

import { invalidateOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import { assertCallerCanGrantPermissionCodes } from '@/domains/tenancy/sub-domains/permission/assert-grantable-permissions.util.js';
import { MemberRolePermissionService } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.service.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { MemberRoleRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role.repository.js';
import type { MemberRolePermissionRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.repository.js';

describe('MemberRolePermissionService', () => {
  const organizationRepository = {
    findByPublicId: vi.fn(),
    resolveUserIdByPublicId: vi.fn(),
  } as unknown as OrganizationRepository;

  const memberRoleRepository = {
    findByPublicId: vi.fn(),
  } as unknown as MemberRoleRepository;

  const memberRolePermissionRepository = {
    replace: vi.fn(),
    findByRoleId: vi.fn(),
  } as unknown as MemberRolePermissionRepository;

  // Unused once the grant guard is stubbed, but the constructor requires them.
  const authorizationService = { resolveUserOrganizationPermissions: vi.fn() };
  const permissionRepository = { findAll: vi.fn() };

  const service = new MemberRolePermissionService(
    organizationRepository,
    memberRoleRepository,
    memberRolePermissionRepository,
    authorizationService as never,
    permissionRepository as never,
  );

  const PUT_BODY = { permission_codes: ['tenancy:read', 'tenancy:write'] };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationRepository.findByPublicId).mockResolvedValue({
      id: 1,
      public_id: 'org_public_abc',
    } as never);
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue({
      id: 2,
      public_id: 'role_public',
    } as never);
    vi.mocked(organizationRepository.resolveUserIdByPublicId).mockResolvedValue(7);
    vi.mocked(memberRolePermissionRepository.replace).mockResolvedValue([
      { permission_code: 'tenancy:read' },
    ] as never);
    vi.mocked(memberRolePermissionRepository.findByRoleId).mockResolvedValue([
      { permission_code: 'tenancy:read' },
      { permission_code: 'tenancy:write' },
    ] as never);
  });

  describe('listPermissionCodesForRole', () => {
    it('returns only the permission_code strings from the repository rows', async () => {
      const codes = await service.listPermissionCodesForRole(2);

      expect(memberRolePermissionRepository.findByRoleId).toHaveBeenCalledWith(2);
      expect(codes).toEqual(['tenancy:read', 'tenancy:write']);
    });

    it('returns an empty array when the role has no permissions', async () => {
      vi.mocked(memberRolePermissionRepository.findByRoleId).mockResolvedValueOnce([] as never);

      await expect(service.listPermissionCodesForRole(2)).resolves.toEqual([]);
    });
  });

  describe('list', () => {
    it('throws NotFoundError when the organization does not exist', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValueOnce(null as never);

      await expect(service.list('org_public_abc', 'role_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(memberRolePermissionRepository.findByRoleId).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the role does not exist in the organization', async () => {
      vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValueOnce(null as never);

      await expect(service.list('org_public_abc', 'role_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(memberRolePermissionRepository.findByRoleId).not.toHaveBeenCalled();
    });

    it('resolves the role within the organization and returns its permission rows', async () => {
      const rows = await service.list('org_public_abc', 'role_public');

      // Role is looked up scoped to the resolved organization id (cross-tenant safety).
      expect(memberRoleRepository.findByPublicId).toHaveBeenCalledWith('role_public', 1);
      expect(memberRolePermissionRepository.findByRoleId).toHaveBeenCalledWith(2);
      expect(rows).toEqual([
        { permission_code: 'tenancy:read' },
        { permission_code: 'tenancy:write' },
      ]);
    });
  });

  describe('put', () => {
    it('throws NotFoundError when the organization does not exist', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValueOnce(null as never);

      await expect(
        service.put('org_public_abc', 'role_public', PUT_BODY, 'admin_public'),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(memberRolePermissionRepository.replace).not.toHaveBeenCalled();
      expect(invalidateOrganizationPermissions).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the role does not exist in the organization', async () => {
      vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValueOnce(null as never);

      await expect(
        service.put('org_public_abc', 'role_public', PUT_BODY, 'admin_public'),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(memberRolePermissionRepository.replace).not.toHaveBeenCalled();
    });

    it('checks the caller may grant the requested codes before any write', async () => {
      await service.put('org_public_abc', 'role_public', PUT_BODY, 'admin_public');

      expect(assertCallerCanGrantPermissionCodes).toHaveBeenCalledWith(
        expect.objectContaining({
          callerUserPublicId: 'admin_public',
          organizationPublicId: 'org_public_abc',
          requestedPermissionCodes: ['tenancy:read', 'tenancy:write'],
        }),
      );
    });

    it('replaces the role permission set and invalidates the whole organization namespace', async () => {
      await service.put('org_public_abc', 'role_public', PUT_BODY, 'admin_public');

      expect(organizationRepository.resolveUserIdByPublicId).toHaveBeenCalledWith('admin_public');
      expect(memberRolePermissionRepository.replace).toHaveBeenCalledWith(
        2,
        ['tenancy:read', 'tenancy:write'],
        7,
      );
      expect(invalidateOrganizationPermissions).toHaveBeenCalledWith('org_public_abc');
    });

    it('writes a null created-by and never resolves a user id when no caller is provided', async () => {
      await service.put('org_public_abc', 'role_public', PUT_BODY, undefined);

      // The `created_by ? resolve(...) : null` branch must take the null path — a mutant that
      // flips the condition would call resolveUserIdByPublicId and persist id 7 instead of null.
      expect(organizationRepository.resolveUserIdByPublicId).not.toHaveBeenCalled();
      expect(memberRolePermissionRepository.replace).toHaveBeenCalledWith(
        2,
        ['tenancy:read', 'tenancy:write'],
        null,
      );
    });
  });
});
