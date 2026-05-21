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
  })
  .strict();

export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQueryDto>;
