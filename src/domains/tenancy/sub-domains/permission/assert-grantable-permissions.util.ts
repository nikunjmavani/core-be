import { ForbiddenError } from '@/shared/errors/index.js';
import type { AuthorizationService } from './authorization.service.js';
import type { PermissionRepository } from './permission.repository.js';

/**
 * Ensures the caller holds every permission code they attempt to assign to a role or API key.
 *
 * @remarks
 * Prevents privilege escalation where a user with `role:manage` or `api-key:manage` grants
 * permissions they do not themselves possess (e.g. `organization:delete`, `subscription:manage`).
 */
export async function assertCallerCanGrantPermissionCodes(options: {
  authorizationService: AuthorizationService;
  permissionRepository: PermissionRepository;
  callerUserPublicId: string | undefined;
  organizationPublicId: string;
  requestedPermissionCodes: string[];
}): Promise<void> {
  if (options.requestedPermissionCodes.length === 0) {
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

  const callerPermissionCodes =
    await options.authorizationService.resolveUserOrganizationPermissions(
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
