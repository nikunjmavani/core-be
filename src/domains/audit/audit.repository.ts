import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { countWithCap } from '@/infrastructure/database/utils/capped-count.util.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { logs } from '@/domains/audit/audit.schema.js';
import { api_keys } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.schema.js';
import {
  buildDescendingCreatedAtIdCursorCondition,
  createOpaqueCursorFromRow,
  parseListCursor,
} from '@/shared/utils/http/pagination.util.js';
import type { AuditLogFilters, NewAuditLog } from './audit.types.js';

function buildAuditFilterConditions(filters: AuditLogFilters): SQL[] {
  const conditions: SQL[] = [];
  const { organization_id, actor_user_id, resource_type, action, from, to } = filters;
  if (organization_id !== undefined && organization_id !== null) {
    conditions.push(eq(logs.organization_id, organization_id));
  }
  if (actor_user_id !== undefined && actor_user_id !== null) {
    conditions.push(eq(logs.actor_user_id, actor_user_id));
  }
  if (resource_type !== undefined && resource_type !== null) {
    conditions.push(eq(logs.resource_type, resource_type));
  }
  if (action !== undefined && action !== null) {
    conditions.push(eq(logs.action, action));
  }
  if (from !== undefined && from !== null) {
    conditions.push(gte(logs.created_at, new Date(from)));
  }
  if (to !== undefined && to !== null) {
    conditions.push(lte(logs.created_at, new Date(to)));
  }
  return conditions;
}

/**
 * Data-access layer for `audit.logs`. Append-only writes via {@link AuditRepository.insert};
 * reads expose cursor-paginated filtering on organization, actor, resource, action, and
 * time window, with an optional capped `count(*)` opt-in (bounded by
 * `LIST_TOTAL_COUNT_CAP`) for callers that need an approximate total.
 */
export class AuditRepository {
  async insert(entry: NewAuditLog): Promise<void> {
    await getRequestDatabase().insert(logs).values(entry);
  }

  /**
   * Resolves an organization API key's internal id from its public id under the active
   * organization RLS context (`tenancy.api_keys` is tenant-isolated). Returns `null` for an
   * unknown key so the caller skips writing an unattributable audit row. Soft-deleted keys are
   * intentionally still resolvable so actions remain attributable after the key is later revoked.
   */
  async resolveActorApiKeyId(apiKeyPublicId: string): Promise<number | null> {
    const rows = await getRequestDatabase()
      .select({ id: api_keys.id })
      .from(api_keys)
      .where(eq(api_keys.public_id, apiKeyPublicId))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async findWithFilters(filters: AuditLogFilters) {
    const { after, limit } = filters;
    const includeTotal = filters.include_total === true;
    const filterConditions = buildAuditFilterConditions(filters);
    const countWhere = filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const conditions = [...filterConditions];
    const cursorCondition = buildDescendingCreatedAtIdCursorCondition(
      logs.created_at,
      logs.id,
      parseListCursor(after),
    );
    if (cursorCondition !== undefined) conditions.push(cursorCondition);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch one extra row so has_more is accurate without depending on count(*).
    const rowsPromise = getRequestDatabase()
      .select()
      .from(logs)
      .where(where)
      .orderBy(desc(logs.created_at), desc(logs.id))
      .limit(limit + 1);

    const countPromise = includeTotal
      ? countWithCap({ database: getRequestDatabase(), table: logs, where: countWhere })
      : Promise.resolve(null);

    const [fetchedRows, total] = await Promise.all([rowsPromise, countPromise]);
    const hasMore = fetchedRows.length > limit;
    const items = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
    const lastItem = items.at(-1);
    const nextCursor =
      hasMore && lastItem !== undefined ? createOpaqueCursorFromRow(lastItem) : null;
    return { items, total, hasMore, nextCursor };
  }

  async findRecent(limit: number) {
    return getRequestDatabase()
      .select()
      .from(logs)
      .orderBy(desc(logs.created_at), desc(logs.id))
      .limit(limit);
  }

  /** Lists audit activity rows authored by the user for a GDPR data-export bundle. */
  async listActivityForUserDataExport(
    actor_user_id: number,
    limit: number,
  ): Promise<{ action: string; resource_type: string; created_at: Date }[]> {
    return getRequestDatabase()
      .select({
        action: logs.action,
        resource_type: logs.resource_type,
        created_at: logs.created_at,
      })
      .from(logs)
      .where(eq(logs.actor_user_id, actor_user_id))
      .orderBy(desc(logs.created_at))
      .limit(limit);
  }
}
