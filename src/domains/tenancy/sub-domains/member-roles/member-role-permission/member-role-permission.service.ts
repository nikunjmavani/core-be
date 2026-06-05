import { ForbiddenError, NotFoundError } from '@/shared/errors/index.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { MemberRoleRepository } from '@/domains/tenancy/sub-domains/member-roles/member-role.repository.js';
import type { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';
import type { MemberRolePermissionRepository } from './member-role-permission.repository.js';
import { invalidateOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import { validatePutMemberRolePermissions } from './member-role-permission.validator.js';
import type { AuthorizationService } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';
import type { PermissionRepository } from '@/domains/tenancy/sub-domains/permission/permission.repository.js';
import { assertCallerCanGrantPermissionCodes } from '@/domains/tenancy/sub-domains/permission/assert-grantable-permissions.util.js';

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
 *   (DELETE then INSERT) in a single repository call, then calls
 *   {@link invalidateOrganizationPermissions} so every member holding the role
 *   re-resolves their permissions on the next request (a role's permission set
 *   change can affect many users, so the whole org namespace is bumped).
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
    private readonly authorizationService: AuthorizationService,
    private readonly permissionRepository: PermissionRepository,
    private readonly membershipRepository: MembershipRepository,
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
    created_by_user_public_id: string | undefined,
  ) {
    const parsed = validatePutMemberRolePermissions(body);
    await assertCallerCanGrantPermissionCodes({
      authorizationService: this.authorizationService,
      permissionRepository: this.permissionRepository,
      callerUserPublicId: created_by_user_public_id,
      organizationPublicId: organization_public_id,
      requestedPermissionCodes: parsed.permission_codes,
    });
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
      if (!role) throw new NotFoundError('Role');
      /**
       * Owner-role protection (sec-T2): a `ROLE_MANAGE` holder must not be able to alter
       * the permission set on the role currently assigned to the organization owner — that
       * would strip every permission for everyone holding the role (including the owner)
       * and lock them out of every PERM-gated route until `/transfer-ownership` is invoked.
       * Owner-role permission changes belong to a separate elevated path (admin tooling /
       * future "owner survival" guarantee), not the generic PUT.
       */
      const ownerMembership = await this.membershipRepository.findByUserAndOrganization(
        organization.owner_user_id,
        organization.id,
      );
      if (!ownerMembership) {
        throw new NotFoundError('Owner membership');
      }
      if (ownerMembership.role_id === role.id) {
        throw new ForbiddenError('errors:cannotModifyOwnerRolePermissions');
      }
      const userId = created_by_user_public_id
        ? await this.organizationRepository.resolveUserIdByPublicId(created_by_user_public_id)
        : null;
      const result = await this.memberRolePermissionRepository.replace(
        role.id,
        parsed.permission_codes,
        userId ?? null,
      );
      await invalidateOrganizationPermissions(organization_public_id);
      return result;
    });
  }
}
