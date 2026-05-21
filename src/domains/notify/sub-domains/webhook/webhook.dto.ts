import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

export const CreateWebhookDto = z
  .object({
    url: z.string().trim().url().max(2048),
    secret: trimmedString().max(255).optional(),
    events: z.array(trimmedString().max(100)).min(1),
    is_enabled: z.boolean().optional().default(true),
  })
  .strict();

export const UpdateWebhookDto = z
  .object({
    url: z.string().trim().url().max(2048).optional(),
    secret: trimmedString().max(255).optional(),
    events: z.array(trimmedString().max(100)).min(1).optional(),
    is_enabled: z.boolean().optional(),
  })
  .strict();

export type CreateWebhookInput = z.infer<typeof CreateWebhookDto>;
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookDto>;
