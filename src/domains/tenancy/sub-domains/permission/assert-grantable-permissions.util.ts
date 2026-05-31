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
  callerUserPublicId: string;
  organizationPublicId: string;
  requestedPermissionCodes: string[];
}): Promise<void> {
  if (options.requestedPermissionCodes.length === 0) {
    return;
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
