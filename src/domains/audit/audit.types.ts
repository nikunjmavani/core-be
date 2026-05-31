import type { AuditLogInsert } from './audit.schema.js';

/**
 * Repository-level filters for {@link AuditRepository.findWithFilters}. All
 * identifiers are already resolved to internal numeric ids by the service;
 * `from`/`to` are ISO-8601 strings, `after` is an opaque cursor, and `limit`
 * is the page size enforced by the route's pagination schema.
 */
export interface AuditLogFilters {
  organization_id?: number;
  actor_user_id?: number;
  resource_type?: string;
  action?: string;
  from?: string;
  to?: string;
  after?: string;
  limit: number;
  /** When true, run the expensive count(*) on this growing table; total is otherwise null. */
  include_total?: boolean;
}

/** Row shape for inserting into `audit.logs` (Drizzle insert). */
export type NewAuditLog = AuditLogInsert;

/**
 * Server-internal audit input: resolves `actor_user_id` from the user's public id.
 */
export interface AuditLogRecordInput {
  actorUserPublicId: string;
  action: string;
  resource_type: string;
  resource_id?: number | null;
  target_user_id?: number | null;
  organization_id?: number | null;
  ip_address?: string | null;
  user_agent?: string | null;
  severity?: string;
  metadata?: Record<string, unknown>;
}
