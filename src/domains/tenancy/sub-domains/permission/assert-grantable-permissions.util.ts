import { ForbiddenError } from '@/shared/errors/index.js';
import type { AuthorizationService } from './authorization.service.js';
import type { PermissionRepository } from './permission.repository.js';

/**
 * Ensures the caller holds every permission code they attempt to assign to a role or API key.
 *
 * @remarks
 * Prevents privilege escalation where a user with `role:manage` or `api-key:manage` grants
 * permissions they do not themselves possess (e.g. `organization:delete`, `subscription:manage`).
 *
 * Callers MUST pass the FULL set of codes being added AND removed (the union with the role's
 * existing permission set), not just the new request body. The PUT-role-permissions service
 * does this composition (sec-T2): an empty-array PUT is a *removal* of every currently-held
 * code, and the guard must verify the caller holds them all. Passing only the new set lets
 * a `role:manage` holder downgrade roles they themselves could not have created.
 */
export async function assertCallerCanGrantPermissionCodes(options: {
  authorizationService: AuthorizationService;
  permissionRepository: PermissionRepository;
  callerUserPublicId: string | undefined;
  organizationPublicId: string;
  requestedPermissionCodes: string[];
}): Promise<void> {
  if (options.requestedPermissionCodes.length === 0) {
    // No codes being added or removed (caller-supplied empty body against an already-empty
    // role, or every code in the new set already present). Nothing to authorize. Note: this
    // is NOT the "wipe a populated role" case — callers in that path pass the role's current
    // permission set in the union and never reach this branch. See sec-T2.
    return;
  }

  // An API-key principal has no acting user, so there is no held-permission set to check it
  // against — it can never be authorized to assign permissions to a role or API key. Fail closed
  // against privilege escalation (preserves the pre-union behavior where an empty-userId key
  // resolved to an empty caller-permission set and was denied any non-empty grant).
  if (!options.callerUserPublicId) {
    throw new ForbiddenError('errors:cannotGrantPermissionNotHeld');
  }

  const catalogRows = await options.permissionRepository.findAll();
  const knownPermissionCodes = new Set(catalogRows.map((row) => row.code));

  // sec-r5-L3: resolve the caller's held permissions straight from the database, not the
  // 5-minute Redis cache. This is a privilege-escalation backstop — a code revoked from the
  // caller seconds ago must not still be grantable to a role/API key during the stale window.
  const callerPermissionCodes =
    await options.authorizationService.resolveUserOrganizationPermissionsFromDatabase(
      options.callerUserPublicId,
      options.organizationPublicId,
    );
  const callerPermissionSet = new Set(callerPermissionCodes);

  for (const permissionCode of options.requestedPermissionCodes) {
    if (!(knownPermissionCodes.has(permissionCode) && callerPermissionSet.has(permissionCode))) {
      throw new ForbiddenError('errors:cannotGrantPermissionNotHeld');
    }
  }
}
