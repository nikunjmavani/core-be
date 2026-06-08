import { env } from '@/shared/config/env.config.js';
import { ConflictError, ForbiddenError, NotFoundError } from '@/shared/errors/index.js';
import { isPostgresUniqueViolation } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { MembershipRepository } from '@/domains/tenancy/sub-domains/membership/membership.repository.js';
import type { MemberRoleRepository } from './member-role.repository.js';
import type { MemberRoleOutput, MemberRoleRow } from './member-role.types.js';
import {
  validateCreateMemberRole,
  validateUpdateMemberRole,
  validateListMemberRolesQuery,
} from './member-role.validator.js';
import { serializeMemberRole } from './member-role.serializer.js';
import { invalidateOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/permission-cache.service.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { CursorPaginationInput } from '@/shared/utils/http/pagination.util.js';

/**
 * Application service for the per-organization role catalog: list, get,
 * create, update, and soft-delete custom roles.
 *
 * @remarks
 * - **Algorithm:** every public method runs inside
 *   {@link withOrganizationDatabaseContext} and resolves the caller's
 *   organization through {@link OrganizationService.requireOrganizationMembershipByPublicId}
 *   before touching the role repository, so RLS and membership checks happen
 *   before any data access.
 * - **Failure modes:** `NotFoundError('Role' | 'Organization')` when lookups
 *   miss or rows are soft-deleted; `ValidationError` (i18n) for bad input or
 *   illegal pagination. The repository's unique index on `(organization_id,
 *   name)` raises duplicate-key errors for collisions on create/update.
 * - **Side effects:** writes through `MemberRoleRepository` (insert / update /
 *   soft-delete with `deleted_at`). Deleting a role calls
 *   {@link invalidateOrganizationPermissions} so members who held it stop
 *   resolving its permissions from cache. The companion
 *   {@link MemberRolePermissionService} owns the role's permission set; this
 *   service does not touch `role_permissions`.
 * - **Notes:** `requireRoleRecord*` and `resolveRolePublicId*` helpers are
 *   shared with other tenancy services (membership, invitations) to keep role
 *   identity resolution in one place.
 */
export class MemberRoleService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly memberRoleRepository: MemberRoleRepository,
    private readonly membershipRepository: MembershipRepository,
  ) {}

  async list(organization_public_id: string, pagination: CursorPaginationInput) {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      validateListMemberRolesQuery({
        limit: pagination.limit,
        after: pagination.after,
      });
      const result = await this.memberRoleRepository.findByOrganizationId(
        organization.id,
        omitUndefined({
          after: pagination.after,
          limit: pagination.limit,
        }),
      );
      return {
        items: result.items.map(serializeMemberRole),
        limit: result.limit,
        total: result.total,
        has_more: result.has_more,
        next_cursor: result.next_cursor,
      };
    });
  }

  async requireRoleRecordForOrganization(
    organization_id: number,
    role_public_id: string,
  ): Promise<MemberRoleRow> {
    const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization_id);
    if (!role) throw new NotFoundError('Role');
    return role;
  }

  async requireRoleRecordByPublicId(
    organization_public_id: string,
    role_public_id: string,
  ): Promise<MemberRoleRow> {
    const organization =
      await this.organizationService.requireOrganizationMembershipByPublicId(
        organization_public_id,
      );
    return this.requireRoleRecordForOrganization(organization.id, role_public_id);
  }

  async resolveRolePublicIdForOrganization(
    organization_id: number,
    role_internal_id: number,
  ): Promise<string> {
    const role = await this.memberRoleRepository.findByInternalId(
      role_internal_id,
      organization_id,
    );
    if (!role) throw new NotFoundError('Role');
    return role.public_id;
  }

  async resolveRolePublicIdByInternalId(
    organization_public_id: string,
    role_internal_id: number,
  ): Promise<string> {
    const organization =
      await this.organizationService.requireOrganizationMembershipByPublicId(
        organization_public_id,
      );
    return this.resolveRolePublicIdForOrganization(organization.id, role_internal_id);
  }

  async getByPublicId(
    organization_public_id: string,
    role_public_id: string,
  ): Promise<MemberRoleOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
      if (!role) throw new NotFoundError('Role');
      return serializeMemberRole(role);
    });
  }

  /**
   * Translate a repository write failure into a clean conflict when it is the
   * `(organization_id, name)` unique violation, so duplicate role names surface
   * as 409 instead of an unhandled 500. Any other error is rethrown unchanged.
   */
  private mapRoleNameConflict(error: unknown, name: string | undefined): unknown {
    if (isPostgresUniqueViolation(error)) {
      return new ConflictError('errors:roleNameExists', name ? { name } : undefined);
    }
    return error;
  }

  async create(
    organization_public_id: string,
    body: unknown,
    created_by_user_public_id: string | undefined,
  ): Promise<MemberRoleOutput> {
    const parsed = validateCreateMemberRole(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      // sec-r5-followup-ratelimit-dos-2: enforce the per-org custom-role cap
      // before insert. Mirrors `WEBHOOK_MAX_PER_ORG` in webhook.service.ts —
      // a stability cap, not a security boundary; the per-route rate limit
      // bounds concurrency so the inherent race ("one extra row") is acceptable.
      const activeCount = await this.memberRoleRepository.countActiveByOrganization(
        organization.id,
      );
      if (activeCount >= env.MEMBER_ROLE_MAX_PER_ORG) {
        throw new ConflictError('errors:memberRoleMaxReached', {
          max: env.MEMBER_ROLE_MAX_PER_ORG,
        });
      }
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(created_by_user_public_id);
      try {
        // sec-T3: `is_system` is intentionally omitted — the DTO no longer accepts it
        // from clients and the repository default is false. Only seeds set it (via a
        // server-side path that does not go through this service).
        const created = await this.memberRoleRepository.create(
          omitUndefined({
            organization_id: organization.id,
            name: parsed.name,
            description: parsed.description,
            created_by_user_id: userId ?? null,
          }),
        );
        return serializeMemberRole(created);
      } catch (error) {
        throw this.mapRoleNameConflict(error, parsed.name);
      }
    });
  }

  async update(
    organization_public_id: string,
    role_public_id: string,
    body: unknown,
    updated_by_user_public_id: string | undefined,
  ): Promise<MemberRoleOutput> {
    const parsed = validateUpdateMemberRole(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
      if (!role) throw new NotFoundError('Role');
      // sec-T3: system roles (Admin/Member) are immutable from the API — same guard as delete.
      if (role.is_system) {
        throw new ForbiddenError('errors:cannotModifySystemRole');
      }
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(updated_by_user_public_id);
      let updated: MemberRoleRow | null;
      try {
        updated = await this.memberRoleRepository.update(
          role_public_id,
          organization.id,
          omitUndefined(parsed),
          userId ?? null,
        );
      } catch (error) {
        throw this.mapRoleNameConflict(error, parsed.name);
      }
      if (!updated) throw new NotFoundError('Role');
      return serializeMemberRole(updated);
    });
  }

  /**
   * Soft-deletes a custom role.
   *
   * @remarks
   * sec-T3 guards:
   *   1. **`is_system` guard** — Admin/Member seed roles cannot be deleted from the API.
   *      Surfaces as `ForbiddenError('errors:cannotDeleteSystemRole')`.
   *   2. **Active-membership guard** — refuses to delete a role currently assigned to one
   *      or more active memberships, because the permission-resolution join filters
   *      `isNull(roles.deleted_at)` and would silently strip every member's permission
   *      set. Surfaces as `ConflictError('errors:roleHasActiveMembers')` — clients
   *      must reassign members before deleting.
   *
   * Both checks fire BEFORE the repository `softDelete` so a refused attempt leaves no
   * partial state. The is_system guard runs first so operators get the more actionable
   * "system role" message in the seeded-Admin case (which is the most common attempt).
   */
  async delete(organization_public_id: string, role_public_id: string): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
      if (!role) throw new NotFoundError('Role');
      if (role.is_system) {
        throw new ForbiddenError('errors:cannotDeleteSystemRole');
      }
      const activeMembershipCount = await this.membershipRepository.countActiveByRoleId(
        role.id,
        organization.id,
      );
      if (activeMembershipCount > 0) {
        throw new ConflictError('errors:roleHasActiveMembers');
      }
      const deleted = await this.memberRoleRepository.softDelete(role_public_id, organization.id);
      if (!deleted) throw new NotFoundError('Role');
      await invalidateOrganizationPermissions(organization_public_id);
    });
  }
}
