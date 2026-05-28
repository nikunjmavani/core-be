/**
 * Audit domain demo seed — sample organization activity logs.
 */
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { logs } from '@/domains/audit/audit.schema.js';

/** Per-row payload accepted by {@link seedAuditLogs}; mirrors the insert shape with optional metadata. */
export interface SeedAuditLogPayload {
  organization_id: number;
  actor_user_id: number;
  action: string;
  resource_type: string;
  resource_id?: number;
  severity?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Inserts demo audit-log rows for the seed scripts. Severity defaults to
 * `INFO` and metadata to `{}`. Returns inserted rows in order.
 */
export async function seedAuditLogs(items: SeedAuditLogPayload[]) {
  const inserted = [];
  for (const item of items) {
    const [row] = await getRequestDatabase()
      .insert(logs)
      .values({
        organization_id: item.organization_id,
        actor_user_id: item.actor_user_id,
        action: item.action,
        resource_type: item.resource_type,
        resource_id: item.resource_id,
        severity: item.severity ?? 'INFO',
        metadata: item.metadata ?? {},
      })
      .returning();
    if (row) inserted.push(row);
  }
  return inserted;
}
