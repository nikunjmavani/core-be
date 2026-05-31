import type { AuditRepository } from './audit.repository.js';
import type { AuditLogFilters, AuditLogRecordInput } from './audit.types.js';
import { validateListAuditLogsQuery } from './audit.validator.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import { withGlobalAdminDatabaseContext } from '@/infrastructure/database/contexts/global-admin-database.context.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

/**
 * Owns the canonical write + read paths for the audit log.
 *
 * @remarks
 * Algorithm:
 * 1. {@link AuditService.record} resolves the actor's internal user id from
 *    their public id inside `withUserDatabaseContext` so RLS sees the actor's
 *    organization scope, then inserts the audit row in the same context.
 * 2. {@link AuditService.list} validates query input via Zod, resolves
 *    organization / actor public ids to internal ids, and delegates to
 *    {@link AuditRepository.findWithFilters} for cursor-paginated reads.
 *
 * Failure modes:
 * - Unknown actor public id → logged at `warn`; no row written; caller is
 *   unaffected (writes are best-effort by contract).
 * - DB write failure inside the context → bubbles to the caller; callers
 *   should go through `recordAuditEvent` so the failure is caught and logged.
 *
 * Side effects: one INSERT into `audit_logs.audit_log`. No events emitted —
 * audit is a write target, not an emitter.
 *
 * Notes: callers must never assume immediate-read-your-write through a
 * different organization context, because the row is RLS-scoped to the actor.
 */
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly organizationService: OrganizationService,
    private readonly userService: UserService,
  ) {}

  /**
   * Persists an audit log row inside the actor's user database context.
   *
   * @remarks
   * Algorithm:
   * 1. Resolve `input.actorUserPublicId` → internal user id inside
   *    `withUserDatabaseContext`. Returning `null` means the actor was deleted
   *    between event emission and audit recording; row is skipped.
   * 2. INSERT the row inside the same context so RLS attributes it correctly.
   *
   * Failure modes: unknown actor → silent skip (logged at warn). DB error →
   * thrown; callers should wrap with `recordAuditEvent` for best-effort
   * semantics.
   *
   * Side effects: one INSERT; no event emitted.
   */
  async record(input: AuditLogRecordInput): Promise<void> {
    if (input.organization_id) {
      const organization = await this.organizationService.findOrganizationByInternalId(
        input.organization_id,
      );
      if (!organization) {
        logger.warn(
          { organizationId: input.organization_id },
          'audit.record.unknownOrganizationId',
        );
        return;
      }
      return withOrganizationDatabaseContext(organization.public_id, async () => {
        const user = await this.userService.findUserRecordByPublicId(input.actorUserPublicId);
        if (!user) {
          logger.warn(
            { actorUserPublicId: input.actorUserPublicId },
            'audit.record.unknownActorUserPublicId',
          );
          return;
        }
        await this.repository.insert({
          actor_user_id: user.id,
          action: input.action,
          resource_type: input.resource_type,
          resource_id: input.resource_id ?? null,
          target_user_id: input.target_user_id ?? null,
          organization_id: input.organization_id ?? null,
          ip_address: input.ip_address ?? null,
          user_agent: input.user_agent ?? null,
          severity: input.severity ?? 'INFO',
          metadata: input.metadata ?? {},
        });
      });
    }

    const user = await withUserDatabaseContext(input.actorUserPublicId, () =>
      this.userService.findUserRecordByPublicId(input.actorUserPublicId),
    );
    if (!user) {
      logger.warn(
        { actorUserPublicId: input.actorUserPublicId },
        'audit.record.unknownActorUserPublicId',
      );
      return;
    }

    await withUserDatabaseContext(input.actorUserPublicId, () =>
      this.repository.insert({
        actor_user_id: user.id,
        action: input.action,
        resource_type: input.resource_type,
        resource_id: input.resource_id ?? null,
        target_user_id: input.target_user_id ?? null,
        organization_id: input.organization_id ?? null,
        ip_address: input.ip_address ?? null,
        user_agent: input.user_agent ?? null,
        severity: input.severity ?? 'INFO',
        metadata: input.metadata ?? {},
      }),
    );
  }

  /**
   * Lists audit log rows matching the supplied query (cursor paginated).
   *
   * @remarks
   * Algorithm:
   * 1. `validateListAuditLogsQuery` runs Zod validation and throws
   *    `ValidationError` on bad input.
   * 2. Translate optional public ids (`organization_id`, `actor_user_id`) to
   *    internal ids; when a supplied public id cannot be resolved, return an
   *    empty page immediately so the query never broadens to all visible rows.
   * 3. Repository runs the cursor-paginated query, optionally including the
   *    `total` count when `include_total === 'true'` (expensive on large
   *    histories — caller must opt in).
   *
   * Failure modes: invalid query → `ValidationError` → 400. Unknown public id
   * in a supplied filter → empty page (no repository call).
   *
   * Side effects: read-only.
   *
   * Notes: caller must already hold `audit-log:read` on the organization (enforced
   * at the tenancy route via `requireOrganizationPermission`).
   */
  async listForOrganization(organization_public_id: string, query: Record<string, unknown>) {
    return withOrganizationDatabaseContext(organization_public_id, () => this.list(query));
  }

  /**
   * Lists audit log rows for the global admin console under an explicit
   * cross-tenant RLS context.
   *
   * @remarks
   * Algorithm: wraps {@link AuditService.list} in `withGlobalAdminDatabaseContext`
   * so the read runs inside a transaction with `SET LOCAL app.global_admin = true`.
   * The `audit_logs_tenant_isolation` policy honours this escape hatch, so the
   * cross-tenant listing is RLS-correct even under FORCE RLS / least-privilege
   * roles instead of silently depending on the table-owner bypass.
   *
   * Failure modes: invalid query → `ValidationError` → 400 (raised inside the
   * wrapped `list`).
   *
   * Side effects: read-only; opens one pinned transaction for the listing.
   *
   * Notes: callers must already hold a global admin role (enforced at the route
   * level via `requireRole(SUPER_ADMIN, ADMIN)`); this context bypasses tenant
   * isolation and must never be reachable without that gate.
   */
  async listForAdmin(query: Record<string, unknown>) {
    return withGlobalAdminDatabaseContext(() => this.list(query));
  }

  async list(query: Record<string, unknown>) {
    const parsed = validateListAuditLogsQuery(query);

    let organization_id: number | undefined;
    let actor_user_id: number | undefined;

    if (parsed.organization_id) {
      const organization = await this.organizationService.findOrganizationByPublicId(
        parsed.organization_id,
      );
      if (!organization) {
        return {
          items: [],
          total: 0,
          limit: parsed.limit,
          has_more: false,
          next_cursor: null,
        };
      }
      organization_id = organization.id;
    }

    if (parsed.actor_user_id) {
      const user = await this.userService.findUserRecordByPublicId(parsed.actor_user_id);
      if (!user) {
        return {
          items: [],
          total: 0,
          limit: parsed.limit,
          has_more: false,
          next_cursor: null,
        };
      }
      actor_user_id = user.id;
    }

    const filters: AuditLogFilters = omitUndefined({
      organization_id,
      actor_user_id,
      resource_type: parsed.resource_type,
      action: parsed.action,
      from: parsed.from,
      to: parsed.to,
      after: parsed.after,
      limit: parsed.limit,
      include_total: parsed.include_total === 'true',
    });

    const { items, total, hasMore, nextCursor } = await this.repository.findWithFilters(filters);

    return {
      items,
      total,
      limit: parsed.limit,
      has_more: hasMore,
      next_cursor: nextCursor,
    };
  }

  /**
   * Lists audit rows where the user is the actor, for GDPR data-export bundles (user-scoped RLS).
   */
  async listActivityForUserDataExport(options: { userPublicId: string; limit: number }) {
    const user = await this.userService.requireUserRecordByPublicId(options.userPublicId);
    return withUserDatabaseContext(options.userPublicId, (_databaseHandle) =>
      this.repository.listActivityForUserDataExport(user.id, options.limit),
    );
  }
}
