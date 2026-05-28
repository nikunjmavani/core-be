import { NotFoundError } from '@/shared/errors/index.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '../../organization/organization.repository.js';
import type { MemberRoleRepository } from '../member-role.repository.js';
import type { MemberRolePermissionRepository } from './member-role-permission.repository.js';
import { validatePutMemberRolePermissions } from './member-role-permission.validator.js';

/**
 * Manages the set of permission codes assigned to a member role within an
 * organization.
 *
 * @remarks
 * - **Algorithm:** every public method runs under {@link withOrganizationDatabaseContext}
 *   so Postgres RLS sees `app.current_organization_id`; the org and role are
 *   resolved by public id, then the repository is invoked.
 * - **Failure modes:** `NotFoundError` when the organization or role does not
 *   exist (or has been soft-deleted); Zod `ValidationError` from
 *   {@link validatePutMemberRolePermissions} for malformed input.
 * - **Side effects:** {@link put} replaces the role's entire permission set
 *   (DELETE then INSERT) in a single repository call; permission cache
 *   invalidation for affected memberships is the responsibility of higher
 *   layers when roles are reassigned.
 * - **Notes:** `listPermissionCodesForRole` is the read path consumed by
 *   {@link MembershipService.getPermissions}; it returns only `permission_code`
 *   strings and does not enforce org context (callers must already be inside
 *   one).
 */
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
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
      if (!role) throw new NotFoundError('Role');
      return this.memberRolePermissionRepository.findByRoleId(role.id);
    });
  }

  async put(
    organization_public_id: string,
    role_public_id: string,
    body: unknown,
    created_by_user_public_id: string,
  ) {
    const parsed = validatePutMemberRolePermissions(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
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
    });
  }
}
