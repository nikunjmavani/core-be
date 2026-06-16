import type { AuthMeContextData, AuthMeContextOutput } from './auth-me-context.types.js';

/**
 * Serializes the aggregated {@link AuthMeContextData} into the public
 * `GET /auth/me/context` response. The user, active organization, permissions,
 * and global role are already public shapes and pass through unchanged; each
 * organization in the switcher list is flagged with `is_active`.
 */
export function serializeAuthMeContext(data: AuthMeContextData): AuthMeContextOutput {
  return {
    user: data.user,
    active_organization: data.activeOrganization,
    my_permissions: data.myPermissions,
    global_role: data.globalRole,
    organizations: data.organizations.map((organization) => ({
      ...organization,
      is_active: organization.id === data.activeOrganizationPublicId,
    })),
  };
}
