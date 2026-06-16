import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from '@/shared/errors/index.js';
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
import type { AuthorizationService } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';
import type { PermissionRepository } from '@/domains/tenancy/sub-domains/permission/permission.repository.js';
import { assertCallerCanGrantPermissionCodes } from '@/domains/tenancy/sub-domains/permission/assert-grantable-permissions.util.js';
import type { MembershipRepository } from './membership.repository.js';
import type { MembershipOutput, MembershipRow } from './membership.types.js';
import {
  validateCreateMembership,
  validateUpdateMembership,
  validateListMembershipsQuery,
  validateTransferOwnership,
} from './membership.validator.js';
import { serializeMembership } from './membership.serializer.js';
import { invalidatePermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import type { OrganizationApiKeyRepository } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.repository.js';

/**
 * HTTP response shape for `GET
 * /organization/memberships/:membership_id/permissions` — the resolved
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
    private readonly authorizationService: AuthorizationService,
    private readonly permissionRepository: PermissionRepository,
    private readonly organizationSettingsService?: OrganizationSettingsService,
    private readonly userSettingsService?: UserSettingsService,
    // reaudit-#7: optional so minimal test harnesses can omit it; the container always wires it.
    private readonly organizationApiKeyRepository?: OrganizationApiKeyRepository,
  ) {}

  /**
   * Revokes every API key the departing member created in this organization (reaudit-#7), so a
   * removed/left member's keys lose access along with their session. Runs inside the caller's
   * organization DB context (RLS-scoped). Best-effort: skipped when the api-key repository is not
   * wired (minimal test harness).
   */
  private async revokeApiKeysForDepartedMember(
    userId: number,
    organizationId: number,
  ): Promise<void> {
    if (!this.organizationApiKeyRepository) return;
    await this.organizationApiKeyRepository.revokeAllByCreatorInOrganization(
      organizationId,
      userId,
    );
  }

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

  /**
   * Resolves a single membership's user + role public ids and serializes it. The internal
   * `user_id`/`role_id` are never emitted; user ids go through the SECURITY DEFINER resolver
   * (auth.users is FORCE RLS and unreachable by a plain join under org-only context).
   */
  private async resolveAndSerializeMembership(
    membership: MembershipRow,
    organization_public_id: string,
  ): Promise<MembershipOutput> {
    const userPublicIds = await this.membershipRepository.resolveUserPublicIdsByInternalIds([
      membership.user_id,
    ]);
    const rolePublicIds = await this.membershipRepository.resolveRolePublicIdsByInternalIds([
      membership.role_id,
    ]);
    return serializeMembership(
      membership,
      organization_public_id,
      userPublicIds.get(membership.user_id) ?? String(membership.user_id),
      rolePublicIds.get(membership.role_id) ?? String(membership.role_id),
    );
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
      // Batch-resolve all user + role public ids for the page (one query each, no N+1).
      const userPublicIds = await this.membershipRepository.resolveUserPublicIdsByInternalIds(
        result.items.map((membership) => membership.user_id),
      );
      const rolePublicIds = await this.membershipRepository.resolveRolePublicIdsByInternalIds(
        result.items.map((membership) => membership.role_id),
      );
      return {
        ...result,
        items: result.items.map((membership) =>
          serializeMembership(
            membership,
            organization_public_id,
            userPublicIds.get(membership.user_id) ?? String(membership.user_id),
            rolePublicIds.get(membership.role_id) ?? String(membership.role_id),
          ),
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
      return this.resolveAndSerializeMembership(membership, organization_public_id);
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
      // Capability matrix: a PERSONAL organization is single-member by definition. The invitation
      // flow already blocks this, but membership-create is a second entry point (a holder of
      // MEMBERSHIP_MANAGE — which the personal-org owner has — could otherwise seed a second member
      // directly). Reject here so the single-member invariant holds at every door. Collaboration
      // requires a TEAM organization.
      if (organization.type === 'PERSONAL') {
        throw new UnprocessableEntityError('errors:personalOrganizationNoMembers');
      }
      const role = await this.memberRoleService.requireRoleRecordByPublicId(
        organization_public_id,
        parsed.role_id,
      );
      // Privilege-escalation guard: the caller must already hold every permission the assigned
      // role would grant. Without this, a holder of `MEMBERSHIP_MANAGE` + `INVITATION_MANAGE`
      // could mint an Admin (or any privileged) membership for a throwaway account and accept
      // the invitation unauthenticated → full organization takeover. Runs BEFORE the row is
      // persisted so a rejected attempt leaves no half-state.
      const rolePermissionCodes = await this.memberRolePermissionService.listPermissionCodesForRole(
        role.id,
      );
      await assertCallerCanGrantPermissionCodes({
        authorizationService: this.authorizationService,
        permissionRepository: this.permissionRepository,
        callerUserPublicId: invited_by_user_public_id,
        organizationPublicId: organization_public_id,
        requestedPermissionCodes: rolePermissionCodes,
      });
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
      return this.resolveAndSerializeMembership(created, organization_public_id);
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
       * sec-new-T1: The org owner's membership must not be modified by other members.
       * An Admin holding MEMBERSHIP_MANAGE could otherwise SUSPEND the owner, locking
       * them out of all RBAC-gated routes with no self-recovery path. The ownership
       * transfer endpoint is the correct mechanism for any ownership-adjacent change.
       */
      if (organization.owner_user_id === membership.user_id) {
        throw new ForbiddenError('errors:ownerMembershipCannotBeModified');
      }
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
      return this.resolveAndSerializeMembership(updated, organization_public_id);
    });
  }

  async delete(organization_public_id: string, membership_public_id: string): Promise<void> {
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
      // The owner cannot be removed — they must transfer ownership first, or the organization
      // would be left without an owner.
      if (organization.owner_user_id === membership.user_id) {
        throw new ForbiddenError('errors:ownerCannotBeRemoved');
      }
      const deleted = await this.membershipRepository.softDelete(
        membership_public_id,
        organization.id,
      );
      if (!deleted) {
        // The atomic owner-guard refused the delete (a concurrent transfer made this member the
        // owner after the check above) or the row vanished — re-resolve for the precise error.
        const current =
          await this.organizationService.requireOrganizationMembershipByPublicId(
            organization_public_id,
          );
        if (current.owner_user_id === membership.user_id) {
          throw new ForbiddenError('errors:ownerCannotBeRemoved');
        }
        throw new NotFoundError('Membership');
      }
      // reaudit-#7: revoke the removed member's API keys so they lose access too.
      await this.revokeApiKeysForDepartedMember(deleted.user_id, organization.id);
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
      if (!deleted) {
        // The atomic owner-guard refused the delete: a concurrent transfer made this user the
        // owner after the pre-check above (which would otherwise orphan the org), or the row
        // vanished. Re-resolve so the race surfaces the same ownerCannotLeave as the pre-check.
        const current =
          await this.organizationService.requireOrganizationMembershipByPublicId(
            organization_public_id,
          );
        if (current.owner_user_id === userId) {
          throw new ForbiddenError('errors:ownerCannotLeave');
        }
        throw new NotFoundError('Membership');
      }
      // reaudit-#7: revoke the departing member's API keys so they lose access too.
      await this.revokeApiKeysForDepartedMember(userId, organization.id);
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
      // A PERSONAL organization belongs solely to its owner and cannot be handed off.
      if (organization.type === 'PERSONAL') {
        throw new UnprocessableEntityError('errors:personalOrganizationImmutable');
      }
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
      if (newOwnerMembership?.status !== 'ACTIVE') {
        throw new NotFoundError('New owner must be an active member');
      }
      await this.organizationService.transferOrganizationOwnership(
        organization_public_id,
        newOwnerUserId,
      );
      return this.resolveAndSerializeMembership(newOwnerMembership, organization_public_id);
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
