import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

/**
 * Zod schema for the `GET /organizations/:id/webhooks` query string — extends cursor pagination
 * with an opt-in `include_total` flag.
 */
export const listWebhooksQueryDto = cursorPaginationSchema
  .extend({
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();

/**
 * Zod schema for the `GET /organizations/:id/webhooks/:webhookId/delivery-attempts` query string
 * — extends cursor pagination with an opt-in `include_total` flag.
 */
export const listWebhookDeliveryAttemptsQueryDto = cursorPaginationSchema
  .extend({
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();

/**
 * Zod schema for the `POST /organizations/:id/webhooks` request body — at least one event,
 * https URL up to 2 KB, and an optional plaintext secret that the service encrypts before
 * persisting.
 */
export const CreateWebhookDto = z
  .object({
    url: z.string().trim().url().max(2048),
    secret: trimmedString().max(255).optional(),
    events: z.array(trimmedString().max(100)).min(1),
    is_enabled: z.boolean().optional().default(true),
  })
  .strict();

/**
 * Zod schema for the `PATCH /organizations/:id/webhooks/:webhookId` request body — every field
 * is optional so callers may toggle `is_enabled`, rotate the secret, or replace the URL/events
 * independently.
 */
export const UpdateWebhookDto = z
  .object({
    url: z.string().trim().url().max(2048).optional(),
    secret: trimmedString().max(255).optional(),
    events: z.array(trimmedString().max(100)).min(1).optional(),
    is_enabled: z.boolean().optional(),
  })
  .strict();

/** Type inferred from {@link listWebhooksQueryDto}. */
export type ListWebhooksQueryInput = z.infer<typeof listWebhooksQueryDto>;
/** Type inferred from {@link listWebhookDeliveryAttemptsQueryDto}. */
export type ListWebhookDeliveryAttemptsQueryInput = z.infer<
  typeof listWebhookDeliveryAttemptsQueryDto
>;
/** Type inferred from {@link CreateWebhookDto}. */
export type CreateWebhookInput = z.infer<typeof CreateWebhookDto>;
/** Type inferred from {@link UpdateWebhookDto}. */
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookDto>;
