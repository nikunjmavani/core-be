import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/errors/index.js';
import { isPostgresUniqueViolation } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import type { UserSettingsService } from '@/domains/user/sub-domains/user-settings/user-settings.service.js';
import {
  isFactoryDefaultUserLocaleSettings,
  preferredLocalesForOrganizationDefaultLocale,
} from '@/domains/user/sub-domains/user-settings/user-settings-locale-defaults.util.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { MemberRoleService } from '@/domains/tenancy/sub-domains/member-roles/member-role.service.js';
import type { MemberRolePermissionService } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.service.js';
import type { MembershipRepository } from './membership.repository.js';
import type { MembershipOutput } from './membership.types.js';
import {
  validateCreateMembership,
  validateUpdateMembership,
  validateListMembershipsQuery,
  validateTransferOwnership,
} from './membership.validator.js';
import { serializeMembership } from './membership.serializer.js';
import { invalidatePermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';

/**
 * HTTP response shape for `GET
 * /organizations/:id/memberships/:membershipId/permissions` — the resolved
 * permission codes for the membership's current role.
 *
 * @remarks
 * - **Algorithm:** computed by joining `memberships -> roles ->
 *   role_permissions` for the requested membership and projecting only the
 *   `permission_code` column.
 * - **Failure modes:** carries no state of its own; producers raise
 *   `NotFoundError('Membership')` when the membership cannot be resolved.
 * - **Side effects:** none — this is a plain DTO.
 * - **Notes:** identifies the membership by public id; codes are flat strings
 *   matching the entries in `tenancy.permissions`.
 */
export interface MembershipPermissionsOutput {
  permissions: string[];
}

/**
 * Application service for organization memberships: list/get/create/update/
 * delete, plus self-service `leaveOrganization` and `transferOwnership`.
 *
 * @remarks
 * - **Algorithm:** every public method runs inside
 *   {@link withOrganizationDatabaseContext} and resolves the caller's
 *   organization through
 *   {@link OrganizationService.requireOrganizationMembershipByPublicId}
 *   before touching the membership repository. `transferOwnership` is
 *   delegated to {@link OrganizationService.transferOrganizationOwnership} so
 *   the `owner_user_id` flip and the membership update happen atomically.
 *   When a brand-new member is created, the service also pushes the
 *   organization's default locale onto the new user via
 *   {@link UserSettingsService.update} if the user is still on factory-default
 *   locale settings.
 * - **Failure modes:** `NotFoundError('Membership' | 'Organization' | 'Role' |
 *   'User')` for missing rows; `ForbiddenError('errors:ownerCannotLeave')`
 *   when the org owner tries to leave;
 *   `ForbiddenError('errors:onlyOwnerCanTransfer')` for non-owner ownership
 *   transfers;
 *   `ForbiddenError('errors:membershipActivationRequiresInvitationAccept')`
 *   when a PATCH tries to flip a never-joined membership to `ACTIVE` (initial
 *   activation must come from invitation acceptance);
 *   `ValidationError` from Zod-backed validators.
 * - **Side effects:** writes through `MembershipRepository` (insert / update /
 *   soft-delete with `deleted_at`); calls {@link invalidatePermissions} after
 *   every membership mutation that changes effective permissions (create,
 *   update, delete, leave) so the affected user's Redis permission cache is
 *   purged immediately instead of lingering for the cache TTL; updates
 *   {@link UserSettingsService} for locale defaults.
 * - **Notes:** `getPermissions` reads through
 *   {@link MemberRolePermissionService.listPermissionCodesForRole} so role
 *   permissions remain a single source of truth.
 */
export class MembershipService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly memberRoleService: MemberRoleService,
    private readonly memberRolePermissionService: MemberRolePermissionService,
    private readonly membershipRepository: MembershipRepository,
    private readonly organizationSettingsService?: OrganizationSettingsService,
    private readonly userSettingsService?: UserSettingsService,
  ) {}

  private async invalidatePermissionsForMembership(
    user_internal_id: number,
    organization_public_id: string,
  ): Promise<void> {
    const userPublicId =
      await this.organizationService.resolveUserPublicIdByInternalId(user_internal_id);
    if (userPublicId) {
      await invalidatePermissions(userPublicId, organization_public_id);
    }
  }

  private async applyOrganizationLocaleDefaults(
    userPublicId: string,
    organizationPublicId: string,
  ): Promise<void> {
    if (!(this.organizationSettingsService && this.userSettingsService)) return;
    const currentSettings = await this.userSettingsService.get(userPublicId);
    if (!isFactoryDefaultUserLocaleSettings(currentSettings)) return;
    const defaultLocale =
      await this.organizationSettingsService.resolveDefaultLocaleForOrganization(
        organizationPublicId,
      );
    await this.userSettingsService.update(userPublicId, {
      language: defaultLocale,
      preferred_locales: preferredLocalesForOrganizationDefaultLocale(defaultLocale),
    });
  }

  async list(organization_public_id: string, query: unknown) {
    const parsed = validateListMembershipsQuery(query);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const result = await this.membershipRepository.findByOrganizationId(
        organization.id,
        omitUndefined({
          after: parsed.after,
          limit: parsed.limit,
        }),
      );
      return {
        ...result,
        items: result.items.map((membership) =>
          serializeMembership(membership, organization_public_id),
        ),
      };
    });
  }

  async getByPublicId(
    organization_public_id: string,
    membership_public_id: string,
  ): Promise<MembershipOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const membership = await this.membershipRepository.findByPublicId(
        membership_public_id,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      return serializeMembership(membership, organization_public_id);
    });
  }

  async create(
    organization_public_id: string,
    body: unknown,
    invited_by_user_public_id: string | undefined,
  ): Promise<MembershipOutput> {
    const parsed = validateCreateMembership(body);
    // A freshly created membership has never joined (joined_at IS NULL), so creating it
    // directly as ACTIVE both violates chk_memberships_joined (would 500) and bypasses the
    // invariant that initial activation comes from invitation acceptance — the same rule the
    // PATCH path enforces. Reject it cleanly instead of letting the constraint surface a 500.
    if (parsed.status === 'ACTIVE') {
      throw new ForbiddenError('errors:membershipActivationRequiresInvitationAccept');
    }
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const role = await this.memberRoleService.requireRoleRecordByPublicId(
        organization_public_id,
        parsed.role_id,
      );
      const userId = await this.organizationService.resolveUserInternalIdByPublicId(parsed.user_id);
      if (userId === null) throw new NotFoundError('User');
      const inviterId =
        await this.organizationService.resolveUserInternalIdByPublicId(invited_by_user_public_id);
      let created: Awaited<ReturnType<MembershipRepository['create']>>;
      try {
        created = await this.membershipRepository.create(
          omitUndefined({
            organization_id: organization.id,
            user_id: userId,
            role_id: role.id,
            status: parsed.status,
            invited_by_user_id: inviterId,
            created_by_user_id: inviterId,
          }),
        );
      } catch (error) {
        // The user already belongs to this organization (idx_memberships_user_org_unique) —
        // surface a clean 409 instead of an unhandled unique_violation 500.
        if (isPostgresUniqueViolation(error)) {
          throw new ConflictError('errors:membershipAlreadyExists');
        }
        throw error;
      }
      await invalidatePermissions(parsed.user_id, organization_public_id);
      await this.applyOrganizationLocaleDefaults(parsed.user_id, organization_public_id);
      return serializeMembership(created, organization_public_id);
    });
  }

  async update(
    organization_public_id: string,
    membership_public_id: string,
    body: unknown,
    updated_by_user_public_id: string | undefined,
  ): Promise<MembershipOutput> {
    const parsed = validateUpdateMembership(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const membership = await this.membershipRepository.findByPublicId(
        membership_public_id,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      /**
       * Initial activation must be driven by invitation acceptance, not a
       * manager PATCH. A membership that has never joined (`joined_at IS NULL`,
       * i.e. still `INVITED`) cannot be flipped to `ACTIVE` here. Reactivating a
       * previously-active member (e.g. `SUSPENDED -> ACTIVE`, which already has
       * `joined_at` set) stays allowed so admin suspend/reactivate flows work.
       */
      if (parsed.status === 'ACTIVE' && membership.joined_at === null) {
        throw new ForbiddenError('errors:membershipActivationRequiresInvitationAccept');
      }
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(updated_by_user_public_id);
      const updated = await this.membershipRepository.update(
        membership_public_id,
        organization.id,
        omitUndefined(parsed),
        userId ?? null,
      );
      if (!updated) throw new NotFoundError('Membership');
      await this.invalidatePermissionsForMembership(updated.user_id, organization_public_id);
      return serializeMembership(updated, organization_public_id);
    });
  }

  async delete(organization_public_id: string, membership_public_id: string): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const deleted = await this.membershipRepository.softDelete(
        membership_public_id,
        organization.id,
      );
      if (!deleted) throw new NotFoundError('Membership');
      await this.invalidatePermissionsForMembership(deleted.user_id, organization_public_id);
    });
  }

  async getPermissions(
    organization_public_id: string,
    membership_public_id: string,
  ): Promise<MembershipPermissionsOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const membership = await this.membershipRepository.findByPublicId(
        membership_public_id,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      const permissionCodes = await this.memberRolePermissionService.listPermissionCodesForRole(
        membership.role_id,
      );
      return { permissions: permissionCodes };
    });
  }

  async leaveOrganization(organization_public_id: string, user_public_id: string): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const userId = await this.organizationService.resolveUserInternalIdByPublicId(user_public_id);
      if (userId === null) throw new NotFoundError('User');
      const membership = await this.membershipRepository.findByUserAndOrganization(
        userId,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      if (organization.owner_user_id === userId) {
        throw new ForbiddenError('errors:ownerCannotLeave');
      }
      const deleted = await this.membershipRepository.softDelete(
        membership.public_id,
        organization.id,
      );
      if (!deleted) throw new NotFoundError('Membership');
      await invalidatePermissions(user_public_id, organization_public_id);
    });
  }

  async transferOwnership(
    organization_public_id: string,
    body: unknown,
    current_user_public_id: string,
  ): Promise<MembershipOutput> {
    const parsed = validateTransferOwnership(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const currentUserId =
        await this.organizationService.resolveUserInternalIdByPublicId(current_user_public_id);
      if (currentUserId === null) throw new NotFoundError('User');
      if (organization.owner_user_id !== currentUserId) {
        throw new ForbiddenError('errors:onlyOwnerCanTransfer');
      }
      const newOwnerUserId = await this.organizationService.resolveUserInternalIdByPublicId(
        parsed.new_owner_user_id,
      );
      if (newOwnerUserId === null) throw new NotFoundError('User');
      const newOwnerMembership = await this.membershipRepository.findByUserAndOrganization(
        newOwnerUserId,
        organization.id,
      );
      if (!newOwnerMembership || newOwnerMembership.status !== 'ACTIVE') {
        throw new NotFoundError('New owner must be an active member');
      }
      await this.organizationService.transferOrganizationOwnership(
        organization_public_id,
        newOwnerUserId,
      );
      return serializeMembership(newOwnerMembership, organization_public_id);
    });
  }

  /**
   * Lists organization memberships for a GDPR data-export bundle under the requesting user's RLS
   * context (cross-organization read scoped to the owner).
   */
  async listOrganizationsForUserDataExport(options: {
    userPublicId: string;
    userInternalId: number;
    limit: number;
  }) {
    return withUserDatabaseContext(options.userPublicId, (_databaseHandle) =>
      this.membershipRepository.listOrganizationsForUserDataExport(
        options.userInternalId,
        options.limit,
      ),
    );
  }
}
