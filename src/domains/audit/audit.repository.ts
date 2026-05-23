import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { logs } from '@/domains/audit/audit.schema.js';
import type { AuditLogFilters, NewAuditLog } from './audit.types.js';

export class AuditRepository {
  async insert(entry: NewAuditLog): Promise<void> {
    await getRequestDatabase().insert(logs).values(entry);
  }

  async findWithFilters(filters: AuditLogFilters) {
    const { page, limit, organization_id, actor_user_id, resource_type, action, from, to } =
      filters;
    const includeTotal = filters.include_total !== false;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (organization_id !== undefined && organization_id !== null)
      conditions.push(eq(logs.organization_id, organization_id));
    if (actor_user_id !== undefined && actor_user_id !== null)
      conditions.push(eq(logs.actor_user_id, actor_user_id));
    if (resource_type !== undefined && resource_type !== null)
      conditions.push(eq(logs.resource_type, resource_type));
    if (action !== undefined && action !== null) conditions.push(eq(logs.action, action));
    if (from !== undefined && from !== null) conditions.push(gte(logs.created_at, new Date(from)));
    if (to !== undefined && to !== null) conditions.push(lte(logs.created_at, new Date(to)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch one extra row so has_more is accurate without depending on count(*).
    const rowsPromise = getRequestDatabase()
      .select()
      .from(logs)
      .where(where)
      .orderBy(desc(logs.created_at))
      .limit(limit + 1)
      .offset(offset);

    const countPromise = includeTotal
      ? getRequestDatabase()
          .select({ count: sql<number>`count(*)::int` })
          .from(logs)
          .where(where)
          .then((rows) => rows[0]?.count ?? 0)
      : Promise.resolve(null);

    const [fetchedRows, total] = await Promise.all([rowsPromise, countPromise]);
    const hasMore = fetchedRows.length > limit;
    const items = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
    return { items, total, hasMore };
  }

  async findRecent(limit: number) {
    return getRequestDatabase().select().from(logs).orderBy(desc(logs.created_at)).limit(limit);
  }
}
