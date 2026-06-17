import type { GlobalRole } from '@/shared/constants/roles.constants.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { AuthorizationService } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';
import type { OrganizationOutput } from '@/domains/tenancy/sub-domains/organization/organization.types.js';
import type { AuthMeContextData } from './auth-me-context.types.js';

/**
 * Aggregates the authenticated caller's "effective context" in one read: their
 * self profile, the active organization (with type-derived capabilities), the
 * permission codes they hold in that org, their global role, and the
 * organizations they belong to (for an org switcher).
 *
 * @remarks
 * - **Algorithm:** sequential cross-domain reads through services (never
 *   repositories) — `UserService.getMe`, `OrganizationService.list`, and, when an
 *   active org is in scope, `OrganizationService.getByPublicId` +
 *   `AuthorizationService.resolveUserOrganizationPermissions`.
 * - **Failure modes:** propagates `NotFoundError` when the user or active org is
 *   not accessible to the caller; an absent active-org claim yields
 *   `activeOrganization: null` and empty permissions rather than an error.
 * - **Side effects:** none (read-only); permission resolution is Redis-cached.
 * - **Notes:** owns no tables — it composes the existing `/users/me`,
 *   `/tenancy/organization(s)`, and permission-resolution reads behind one call so
 *   the surface stays identical for personal and team organizations.
 */
export class AuthMeContextService {
  constructor(
    private readonly userService: UserService,
    private readonly organizationService: OrganizationService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  /** Assembles the caller's effective context for `GET /auth/me/context`. */
  async getContext(options: {
    userPublicId: string;
    activeOrganizationPublicId: string | undefined;
    globalRole: GlobalRole | undefined;
  }): Promise<AuthMeContextData> {
    const { userPublicId, activeOrganizationPublicId, globalRole } = options;

    const user = await this.userService.getMe(userPublicId);
    const organizationsPage = await this.organizationService.list({}, userPublicId, globalRole);

    let activeOrganization: OrganizationOutput | null = null;
    let myPermissions: string[] = [];
    if (activeOrganizationPublicId) {
      activeOrganization = await this.organizationService.getByPublicId(
        activeOrganizationPublicId,
        userPublicId,
        globalRole,
      );
      myPermissions = await this.authorizationService.resolveUserOrganizationPermissions(
        userPublicId,
        activeOrganizationPublicId,
      );
    }

    return {
      user,
      activeOrganization,
      activeOrganizationPublicId: activeOrganizationPublicId ?? null,
      myPermissions,
      globalRole: globalRole ?? null,
      organizations: organizationsPage.items,
    };
  }
}
