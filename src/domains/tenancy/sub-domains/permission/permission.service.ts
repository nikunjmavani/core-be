import type { PermissionRepository } from './permission.repository.js';

/**
 * Read-only application service backing `GET /permissions` — exposes the
 * global system-wide permission catalog.
 *
 * @remarks
 * - **Algorithm:** delegates to {@link PermissionRepository.findAll}, which
 *   returns the catalog sorted by `(category, code)` and capped by
 *   `DEFAULT_REPOSITORY_LIST_LIMIT`.
 * - **Failure modes:** repository errors propagate; the catalog is small
 *   enough that hitting the safe row cap implies new permissions need to be
 *   added — the repository logs a warning when this happens.
 * - **Side effects:** none (read-only).
 * - **Notes:** keep distinct from {@link AuthorizationService}, which
 *   resolves the codes a specific user has within an organization rather
 *   than enumerating the global catalog.
 */
export class PermissionService {
  constructor(private readonly repository: PermissionRepository) {}

  async list() {
    return this.repository.findAll();
  }
}
