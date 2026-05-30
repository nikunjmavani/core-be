import { withOrganizationContext } from '@/infrastructure/database/contexts/tenant-database.context.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConfigurationError } from '@/shared/errors/index.js';
import {
  getCachedPermissions,
  withPermissionCacheRecomputeLock,
} from './permission-cache.service.js';
import type { PermissionRepository } from './permission.repository.js';

let permissionRepository: PermissionRepository | null = null;

/**
 * Wire repository from tenancy container (composition root).
 *
 * @remarks
 * - **Algorithm:** stores the provided {@link PermissionRepository} in a
 *   module-level singleton so the function-style
 *   {@link resolveUserOrganizationPermissions} export can resolve it without a
 *   class instance.
 * - **Failure modes:** none on its own; downstream callers that hit
 *   {@link resolveUserOrganizationPermissions} before this has been invoked
 *   throw `ConfigurationError`.
 * - **Side effects:** mutates a module-level variable; safe to call multiple
 *   times (last write wins). Called by `tenancy.container.ts` during boot and
 *   by every `new AuthorizationService(...)` for test isolation.
 * - **Notes:** prefer the class-based {@link AuthorizationService} in new code;
 *   the function-style API exists for legacy preHandlers that ran before DI
 *   was introduced.
 */
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

  // The recompute callback only computes; withPermissionCacheRecomputeLock owns the cache
  // write and guards it on the lock nonce, so a racing invalidatePermissions cannot be
  // clobbered by a stale write.
  return withPermissionCacheRecomputeLock(userPublicId, organizationPublicId, async () =>
    withOrganizationContext(organizationPublicId, async (databaseHandle) =>
      repository.findPermissionCodesForUserInOrganization(
        userPublicId,
        organizationPublicId,
        databaseHandle as PostgresJsDatabase,
      ),
    ),
  );
}

/**
 * Resolves the permission codes a user has within a specific organization.
 * Uses Redis cache with 5-minute TTL to avoid repeated 5-table joins.
 *
 * @remarks
 * - **Algorithm:** hits {@link getCachedPermissions} first; on miss takes the
 *   per-(user, organization) Redis recompute lock via
 *   {@link withPermissionCacheRecomputeLock}, then runs the 5-table join
 *   (`role_permissions → roles → memberships → users + organizations`) under
 *   {@link withOrganizationContext} so RLS is satisfied; the lock wrapper then
 *   writes the result to the cache (TTL plus jitter) guarded on the lock nonce.
 * - **Failure modes:** `ConfigurationError` if {@link configureAuthorization}
 *   has not been invoked; Redis errors degrade to a direct database lookup
 *   (logged); database errors bubble up.
 * - **Side effects:** reads and writes Redis under the `perm:*` keyspace;
 *   takes a brief recompute lock; transient Postgres GUC mutation through
 *   `withOrganizationContext`.
 * - **Notes:** module-level wrapper around the class-based
 *   {@link AuthorizationService} so legacy preHandlers without DI can still
 *   call it. Cache entries are invalidated via
 *   {@link invalidatePermissions} on role/permission changes.
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

/**
 * Class-based entry point used by tenancy DI and by Fastify preHandlers
 * (e.g. `requireOrganizationPermission`) to resolve the permission codes a
 * user has within an organization.
 *
 * @remarks
 * - **Algorithm:** delegates to the shared `resolvePermissionsWithRepository`
 *   helper. Constructor also registers the repository with the module-level
 *   singleton via {@link configureAuthorization} so the function-style
 *   {@link resolveUserOrganizationPermissions} export keeps working.
 * - **Failure modes:** Redis or database failures surface as bare errors so
 *   the caller's preHandler can deny the request; never throws from a stale
 *   cache hit.
 * - **Side effects:** Redis reads/writes under `perm:*`; brief Postgres GUC
 *   mutation; cache writes carry TTL+jitter.
 * - **Notes:** results MUST be invalidated by callers that change roles or
 *   role-permission assignments via {@link invalidatePermissions} or
 *   {@link invalidateOrganizationPermissions}.
 */
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
