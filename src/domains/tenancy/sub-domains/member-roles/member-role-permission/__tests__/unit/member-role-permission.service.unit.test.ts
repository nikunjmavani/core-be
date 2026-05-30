import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

vi.mock('@/domains/tenancy/sub-domains/permission/permission-cache.service.js', () => ({
  invalidateOrganizationPermissions: vi.fn().mockResolvedValue(undefined),
}));

import { invalidateOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import { MemberRolePermissionService } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.service.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { MemberRoleRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role.repository.js';
import type { MemberRolePermissionRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.repository.js';

describe('MemberRolePermissionService — permission cache invalidation', () => {
  const organizationRepository = {
    findByPublicId: vi.fn().mockResolvedValue({ id: 1, public_id: 'org_public_abc' }),
    resolveUserIdByPublicId: vi.fn().mockResolvedValue(7),
  } as unknown as OrganizationRepository;

  const memberRoleRepository = {
    findByPublicId: vi.fn().mockResolvedValue({ id: 2, public_id: 'role_public' }),
  } as unknown as MemberRoleRepository;

  const memberRolePermissionRepository = {
    replace: vi.fn().mockResolvedValue([{ permission_code: 'tenancy:read' }]),
  } as unknown as MemberRolePermissionRepository;

  const authorizationService = {
    resolveUserOrganizationPermissions: vi
      .fn()
      .mockResolvedValue(['tenancy:read', 'tenancy:write']),
  };

  const permissionRepository = {
    findAll: vi.fn().mockResolvedValue([{ code: 'tenancy:read' }, { code: 'tenancy:write' }]),
  };

  const service = new MemberRolePermissionService(
    organizationRepository,
    memberRoleRepository,
    memberRolePermissionRepository,
    authorizationService as never,
    permissionRepository as never,
  );

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
  });

  it('put replaces the role permission set and invalidates the whole organization namespace', async () => {
    await service.put(
      'org_public_abc',
      'role_public',
      { permission_codes: ['tenancy:read', 'tenancy:write'] },
      'admin_public',
    );

    expect(memberRolePermissionRepository.replace).toHaveBeenCalledWith(
      2,
      ['tenancy:read', 'tenancy:write'],
      7,
    );
    expect(invalidateOrganizationPermissions).toHaveBeenCalledWith('org_public_abc');
  });
});
