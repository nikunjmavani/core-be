import { NotFoundError } from '@/shared/errors/index.js';
import type { OrganizationRepository } from '../../organization/organization.repository.js';
import type { MemberRoleRepository } from '../member-role.repository.js';
import type { MemberRolePermissionRepository } from './member-role-permission.repository.js';
import { validatePutMemberRolePermissions } from './member-role-permission.validator.js';

export class MemberRolePermissionService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly memberRoleRepository: MemberRoleRepository,
    private readonly memberRolePermissionRepository: MemberRolePermissionRepository,
  ) {}

  async listPermissionCodesForRole(role_id: number): Promise<string[]> {
    const rows = await this.memberRolePermissionRepository.findByRoleId(role_id);
    return rows.map((row) => row.permission_code);
  }

  async list(organization_public_id: string, role_public_id: string) {
    const organization = await this.organizationRepository.findByPublicId(organization_public_id);
    if (!organization) throw new NotFoundError('Organization');
    const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
    if (!role) throw new NotFoundError('Role');
    return this.memberRolePermissionRepository.findByRoleId(role.id);
  }

  async put(
    organization_public_id: string,
    role_public_id: string,
    body: unknown,
    created_by_user_public_id: string,
  ) {
    const parsed = validatePutMemberRolePermissions(body);
    const organization = await this.organizationRepository.findByPublicId(organization_public_id);
    if (!organization) throw new NotFoundError('Organization');
    const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
    if (!role) throw new NotFoundError('Role');
    const userId =
      await this.organizationRepository.resolveUserIdByPublicId(created_by_user_public_id);
    return this.memberRolePermissionRepository.replace(
      role.id,
      parsed.permission_codes,
      userId ?? null,
    );
  }
}
