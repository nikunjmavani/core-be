import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveUserOrganizationPermissions } from '@/domains/tenancy/sub-domains/permission/authorization.service.js';
import type { GlobalRole } from '@/shared/constants/roles.constants.js';
import { ForbiddenError, UnauthorizedError } from '@/shared/errors/index.js';

/** Per-request memo: one Redis/DB resolve per (user, organization) per HTTP request. */
const organizationPermissionResolveMemo = new WeakMap<
  FastifyRequest,
  Map<string, Promise<string[]>>
>();

function buildOrganizationPermissionMemoKey(
  userPublicId: string,
  organizationPublicId: string,
): string {
  return `${userPublicId}:${organizationPublicId}`;
}

function resolveOrganizationPermissionsForRequest(
  request: FastifyRequest,
  userPublicId: string,
  organizationPublicId: string,
): Promise<string[]> {
  const memoKey = buildOrganizationPermissionMemoKey(userPublicId, organizationPublicId);
  let requestMemo = organizationPermissionResolveMemo.get(request);
  if (!requestMemo) {
    requestMemo = new Map();
    organizationPermissionResolveMemo.set(request, requestMemo);
  }
  const existing = requestMemo.get(memoKey);
  if (existing) {
    return existing;
  }
  const resolved = resolveUserOrganizationPermissions(userPublicId, organizationPublicId);
  requestMemo.set(memoKey, resolved);
  return resolved;
}

/**
 * Returns a Fastify preHandler that checks the authenticated user's global role.
 * Throws ForbiddenError if the user's role is not in the allowed list.
 *
 * Usage:
 *   { preHandler: [app.authenticate, requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)] }
 */
export function requireRole(
  ...allowedRoles: GlobalRole[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const auth = request.auth;
    if (!auth?.userId) throw new UnauthorizedError();
    if (!(auth.role && allowedRoles.includes(auth.role))) {
      throw new ForbiddenError('errors:insufficientRolePrivileges');
    }
  };
}

/**
 * Returns a Fastify preHandler that checks the authenticated user has a specific
 * permission within the organization identified by the route param.
 *
 * Looks up: user -> membership -> role -> role_permissions
 *
 * @param permissionCode - The permission code to check (use domain constants, never bare strings)
 * @param paramName - The route param name for org ID (default: 'organizationId', also checks 'id')
 *
 * Usage:
 *   { preHandler: [app.authenticate, requireOrganizationPermission(TENANCY_PERMISSIONS.MEMBERSHIP_MANAGE)] }
 */
export function requireOrganizationPermission(
  permissionCode: string,
  paramName = 'organizationId',
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const auth = request.auth;
    if (!(auth?.userId || auth?.apiKeyPublicId)) throw new UnauthorizedError();

    const params = request.params as Record<string, string>;
    // eslint-disable-next-line security/detect-object-injection -- paramName is a function argument with a typed default.
    const organizationId = params[paramName] ?? params.id;
    if (!organizationId) {
      throw new ForbiddenError('errors:organizationContextRequired');
    }

    if (auth.apiKeyPublicId) {
      if (auth.organizationPublicId && auth.organizationPublicId !== organizationId) {
        throw new ForbiddenError('errors:insufficientOrganizationPermissions');
      }
      const scopes = auth.apiKeyScopes ?? [];
      if (!scopes.includes(permissionCode)) {
        throw new ForbiddenError('errors:insufficientOrganizationPermissions');
      }
      return;
    }

    const permissionCodes = await resolveOrganizationPermissionsForRequest(
      request,
      auth.userId,
      organizationId,
    );
    if (!permissionCodes.includes(permissionCode)) {
      throw new ForbiddenError('errors:insufficientOrganizationPermissions');
    }
  };
}
