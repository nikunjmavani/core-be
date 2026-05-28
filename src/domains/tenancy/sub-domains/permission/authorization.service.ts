import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-database.context.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConfigurationError } from '@/shared/errors/index.js';
import {
  getCachedPermissions,
  setCachedPermissions,
  withPermissionCacheRecomputeLock,
} from './permission-cache.service.js';
import type { PermissionRepository } from './permission.repository.js';

let permissionRepository: PermissionRepository | null = null;

/** Wire repository from tenancy container (composition root). */
export function configureAuthorization(permissionRepositoryInstance: PermissionRepository): void {
  permissionRepository = permissionRepositoryInstance;
}

function getPermissionRepository(): PermissionRepository {
  if (!permissionRepository) {
    throw new ConfigurationError(
      'Authorization is not configured. Call configureAuthorization from tenancy.container.',
    );
  }
  return permissionRepository;
}

async function resolvePermissionsWithRepository(
  repository: PermissionRepository,
  userPublicId: string,
  organizationPublicId: string,
): Promise<string[]> {
  const cached = await getCachedPermissions(userPublicId, organizationPublicId);
  if (cached !== null) {
    return cached;
  }

  return withPermissionCacheRecomputeLock(userPublicId, organizationPublicId, async () => {
    const codes = await withOrganizationContext(organizationPublicId, async (databaseHandle) => {
      return repository.findPermissionCodesForUserInOrganization(
        userPublicId,
        organizationPublicId,
        databaseHandle as PostgresJsDatabase,
      );
    });

    await setCachedPermissions(userPublicId, organizationPublicId, codes);
    return codes;
  });
}

/**
 * Resolves the permission codes a user has within a specific organization.
 * Uses Redis cache with 5-minute TTL to avoid repeated 5-table joins.
 */
export async function resolveUserOrganizationPermissions(
  userPublicId: string,
  organizationPublicId: string,
): Promise<string[]> {
  return resolvePermissionsWithRepository(
    getPermissionRepository(),
    userPublicId,
    organizationPublicId,
  );
}

export class AuthorizationService {
  constructor(private readonly permissionRepository: PermissionRepository) {
    configureAuthorization(permissionRepository);
  }

  resolveUserOrganizationPermissions(
    userPublicId: string,
    organizationPublicId: string,
  ): Promise<string[]> {
    return resolvePermissionsWithRepository(
      this.permissionRepository,
      userPublicId,
      organizationPublicId,
    );
  }
}
