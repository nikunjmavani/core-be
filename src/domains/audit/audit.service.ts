import type { AuditRepository } from './audit.repository.js';
import type { AuditLogFilters, AuditLogRecordInput } from './audit.types.js';
import { validateListAuditLogsQuery } from './audit.validator.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly organizationService: OrganizationService,
    private readonly userService: UserService,
  ) {}

  /**
   * Persists an audit log row. Resolves the actor's internal user id from their
   * public id, then writes the row inside the actor's user database context so
   * RLS sees the correct organization scope.
   */
  async record(input: AuditLogRecordInput): Promise<void> {
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

  async list(query: Record<string, unknown>) {
    const parsed = validateListAuditLogsQuery(query);

    let organization_id: number | undefined;
    let actor_user_id: number | undefined;

    if (parsed.organization_id) {
      const organization = await this.organizationService.findOrganizationByPublicId(
        parsed.organization_id,
      );
      organization_id = organization?.id;
    }

    if (parsed.actor_user_id) {
      const user = await this.userService.findUserRecordByPublicId(parsed.actor_user_id);
      actor_user_id = user?.id;
    }

    const filters: AuditLogFilters = omitUndefined({
      organization_id,
      actor_user_id,
      resource_type: parsed.resource_type,
      action: parsed.action,
      from: parsed.from,
      to: parsed.to,
      after: parsed.after,
      offset_page: parsed.page,
      limit: parsed.limit,
      include_total: parsed.include_total === 'true',
    });

    const { items, total, hasMore, nextCursor } = await this.repository.findWithFilters(filters);

    return {
      items,
      total,
      limit: parsed.limit,
      total_pages: total !== null ? Math.ceil(total / parsed.limit) || 1 : null,
      has_more: hasMore,
      next_cursor: nextCursor,
    };
  }
}
