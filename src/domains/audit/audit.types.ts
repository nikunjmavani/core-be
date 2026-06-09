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
 * Server-internal audit input. After P0-#2 (audit outbox) this carries only
 * `*_public_id` fields — the drain worker resolves them to internal ids
 * out-of-band, so the request handler never pays a lookup-then-insert tax
 * (or a per-row transaction for bulk operations).
 */
export interface AuditLogRecordInput {
  /** Public id of the acting user. Mutually exclusive with {@link actorApiKeyPublicId}. */
  actorUserPublicId?: string | undefined;
  /** Public id of the acting organization API key, when the action was performed by a key rather than a user. */
  actorApiKeyPublicId?: string | undefined;
  action: string;
  resource_type: string;
  resource_id?: number | null;
  /** Public id of the user being acted upon (NEW — replaces the old internal `target_user_id`). */
  target_user_public_id?: string | null;
  /** Organization public id (NEW — replaces the old internal `organization_id`). */
  organization_public_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  severity?: string;
  metadata?: Record<string, unknown>;
}
