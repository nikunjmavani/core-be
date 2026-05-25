import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

import { NotFoundError } from '@/shared/errors/index.js';
import { MemberRoleService } from '@/domains/tenancy/sub-domains/member-roles/member-role.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { MemberRoleRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role.repository.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

const organization = { id: 1, public_id: generatePublicId() };
const roleRow = {
  id: 2,
  public_id: generatePublicId(),
  organization_id: 1,
  name: 'Admin',
  description: 'Admin role',
  is_system: false,
  created_at: new Date(),
  updated_at: new Date(),
};

describe('MemberRoleService', () => {
  const organizationService = {
    requireOrganizationMembershipByPublicId: vi.fn().mockResolvedValue(organization),
    resolveUserInternalIdByPublicId: vi.fn().mockResolvedValue(5),
  } as unknown as OrganizationService;

  const memberRoleRepository = {
    findByOrganizationId: vi
      .fn()
      .mockResolvedValue({ items: [roleRow], has_more: false, next_cursor: null }),
    findByPublicId: vi.fn().mockResolvedValue(roleRow),
    findByInternalId: vi.fn().mockResolvedValue(roleRow),
    create: vi.fn().mockResolvedValue(roleRow),
    update: vi.fn().mockResolvedValue(roleRow),
    softDelete: vi.fn().mockResolvedValue(roleRow),
  } as unknown as MemberRoleRepository;

  const service = new MemberRoleService(organizationService, memberRoleRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockResolvedValue(
      organization as never,
    );
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(5);
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue(roleRow as never);
    vi.mocked(memberRoleRepository.findByInternalId).mockResolvedValue(roleRow as never);
    vi.mocked(memberRoleRepository.update).mockResolvedValue(roleRow as never);
    vi.mocked(memberRoleRepository.softDelete).mockResolvedValue(roleRow as never);
    vi.mocked(memberRoleRepository.create).mockResolvedValue(roleRow as never);
  });

  it('list returns roles', async () => {
    const result = await service.list(organization.public_id, { limit: 20, offsetPage: 1 });
    expect(result.items).toHaveLength(1);
  });

  it('getByPublicId returns role', async () => {
    const result = await service.getByPublicId(organization.public_id, roleRow.public_id);
    expect(result.id).toBe(roleRow.public_id);
  });

  it('create throws when organization is missing', async () => {
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockRejectedValue(
      new NotFoundError('Organization'),
    );
    await expect(
      service.create(organization.public_id, { name: 'Editor' }, 'creator_public'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('create adds role', async () => {
    await service.create(
      organization.public_id,
      { name: 'Editor', description: 'Can edit' },
      'creator_public',
    );
    expect(memberRoleRepository.create).toHaveBeenCalled();
  });

  it('create omits optional description and is_system defaults', async () => {
    await service.create(organization.public_id, { name: 'Minimal' }, 'creator_public');
    expect(memberRoleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Minimal' }),
    );
  });

  it('requireRoleRecordByPublicId returns role row', async () => {
    const record = await service.requireRoleRecordByPublicId(
      organization.public_id,
      roleRow.public_id,
    );
    expect(record.public_id).toBe(roleRow.public_id);
  });

  it('requireRoleRecordForOrganization skips organization lookup', async () => {
    const record = await service.requireRoleRecordForOrganization(
      organization.id,
      roleRow.public_id,
    );
    expect(record.public_id).toBe(roleRow.public_id);
    expect(organizationService.requireOrganizationMembershipByPublicId).not.toHaveBeenCalled();
  });

  it('resolveRolePublicIdForOrganization skips organization lookup', async () => {
    const publicId = await service.resolveRolePublicIdForOrganization(organization.id, roleRow.id);
    expect(publicId).toBe(roleRow.public_id);
    expect(organizationService.requireOrganizationMembershipByPublicId).not.toHaveBeenCalled();
  });

  it('resolveRolePublicIdForOrganization throws when role is missing', async () => {
    vi.mocked(memberRoleRepository.findByInternalId).mockResolvedValue(null);
    await expect(
      service.resolveRolePublicIdForOrganization(organization.id, 999),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resolveRolePublicIdByInternalId resolves via organization membership', async () => {
    const publicId = await service.resolveRolePublicIdByInternalId(
      organization.public_id,
      roleRow.id,
    );
    expect(publicId).toBe(roleRow.public_id);
    expect(organizationService.requireOrganizationMembershipByPublicId).toHaveBeenCalled();
  });

  it('update and delete mutate role', async () => {
    await service.update(
      organization.public_id,
      roleRow.public_id,
      { name: 'Updated' },
      'updater_public',
    );
    await service.delete(organization.public_id, roleRow.public_id);
    expect(memberRoleRepository.update).toHaveBeenCalled();
    expect(memberRoleRepository.softDelete).toHaveBeenCalled();
  });

  it('requireRoleRecordByPublicId throws when missing', async () => {
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue(null);
    await expect(
      service.requireRoleRecordByPublicId(organization.public_id, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('list throws when organization is missing', async () => {
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockRejectedValue(
      new NotFoundError('Organization'),
    );
    await expect(service.list(organization.public_id, { limit: 20 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('getByPublicId throws when role is missing', async () => {
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue(null);
    await expect(
      service.getByPublicId(organization.public_id, roleRow.public_id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('update passes null updater when user id cannot be resolved', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(null);
    await service.update(organization.public_id, roleRow.public_id, { name: 'X' }, 'missing');
    expect(memberRoleRepository.update).toHaveBeenCalledWith(
      roleRow.public_id,
      organization.id,
      { name: 'X' },
      null,
    );
  });

  it('update throws when repository returns null', async () => {
    vi.mocked(memberRoleRepository.update).mockResolvedValue(null);
    await expect(
      service.update(organization.public_id, roleRow.public_id, { name: 'X' }, 'updater'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete throws when soft delete returns null', async () => {
    vi.mocked(memberRoleRepository.softDelete).mockResolvedValue(null);
    await expect(service.delete(organization.public_id, roleRow.public_id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('create supports system roles and missing creator user id', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(null);
    await service.create(
      organization.public_id,
      { name: 'System', description: null, is_system: true },
      'missing_creator',
    );
    expect(memberRoleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ is_system: true, created_by_user_id: null }),
    );
  });

  it('getByPublicId and requireRoleRecordByPublicId throw when organization is missing', async () => {
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockRejectedValue(
      new NotFoundError('Organization'),
    );
    await expect(
      service.getByPublicId(organization.public_id, roleRow.public_id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.requireRoleRecordByPublicId(organization.public_id, roleRow.public_id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('update throws when role is missing', async () => {
    vi.mocked(memberRoleRepository.findByPublicId).mockResolvedValue(null);
    await expect(
      service.update(organization.public_id, roleRow.public_id, { name: 'X' }, 'updater'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('delete throws when organization is missing', async () => {
    vi.mocked(organizationService.requireOrganizationMembershipByPublicId).mockRejectedValue(
      new NotFoundError('Organization'),
    );
    await expect(service.delete(organization.public_id, roleRow.public_id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
