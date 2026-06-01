import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

/**
 * Zod schema for the `GET /api/v1/audit/logs` query string. Extends the shared
 * cursor pagination schema with audit-specific filters and an `include_total`
 * opt-in (kept as a string enum so it renders to JSON Schema for OpenAPI).
 */
export const ListAuditLogsQueryDto = cursorPaginationSchema
  .extend({
    organization_id: trimmedString().max(255).optional(),
    actor_user_id: trimmedString().max(255).optional(),
    resource_type: trimmedString().max(50).optional(),
    action: trimmedString().max(100).optional(),
    from: z.string().trim().datetime().optional(),
    to: z.string().trim().datetime().optional(),
    // Opt in to the expensive count(*) only when exact totals are needed. Defaults to
    // false so the common audit-log browse path stays keyset-only.
    // Kept as a string enum (no transform) so the schema renders to JSON Schema for OpenAPI;
    // the service coerces it to a boolean.
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();

/** Parsed query type inferred from {@link ListAuditLogsQueryDto}. */
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQueryDto>;
