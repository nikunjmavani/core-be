import { z } from 'zod';
import { cursorListQuerySchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

export const ListAuditLogsQueryDto = cursorListQuerySchema
  .extend({
    organization_id: trimmedString().max(255).optional(),
    actor_user_id: trimmedString().max(255).optional(),
    resource_type: trimmedString().max(50).optional(),
    action: trimmedString().max(100).optional(),
    from: z.string().trim().datetime().optional(),
    to: z.string().trim().datetime().optional(),
    // Opt out of the expensive count(*) for deep browsing of this growing table. Defaults to
    // true to preserve the exact-total response; pass `false` for cheap keyset-style paging.
    // Kept as a string enum (no transform) so the schema renders to JSON Schema for OpenAPI;
    // the service coerces it to a boolean.
    include_total: z.enum(['true', 'false']).optional().default('true'),
  })
  .strict();

export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQueryDto>;
