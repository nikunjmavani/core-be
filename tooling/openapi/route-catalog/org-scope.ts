import type { RouteOrgScope } from './types.js';

/**
 * Catalog keys (`METHOD /full/path`) of the routes that a PERSONAL organization
 * rejects with HTTP 422. These mirror the service-layer capability guards (the
 * org `type` is immutable, so the rejection is permanent — 422, not 409):
 *
 *   - membership.service.ts            → add member
 *   - member-invitation.service.ts     → invite member
 *   - member-role.service.ts           → create custom role
 *   - membership.service.ts            → transfer ownership
 *   - organization.service.ts          → delete organization
 *
 * Everything else is `both` (works on personal and team organizations). The
 * `route-catalog-org-scope.unit.test.ts` guard asserts every key here still
 * exists in the generated catalog, so a route rename cannot silently desync.
 */
export const TEAM_ONLY_ROUTE_KEYS: ReadonlySet<string> = new Set([
  'POST /api/v1/tenancy/organization/memberships',
  'POST /api/v1/tenancy/organization/invitations',
  'POST /api/v1/tenancy/organization/roles',
  'POST /api/v1/tenancy/organization/transfer-ownership',
  'DELETE /api/v1/tenancy/organization',
]);

/** Resolves the active-organization scope for a route from {@link TEAM_ONLY_ROUTE_KEYS}. */
export function resolveOrgScope(method: string, fullPath: string): RouteOrgScope {
  return TEAM_ONLY_ROUTE_KEYS.has(`${method.toUpperCase()} ${fullPath}`) ? 'team' : 'both';
}
