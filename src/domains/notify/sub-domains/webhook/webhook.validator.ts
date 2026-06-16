import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import { parseCursorPaginatedQuery } from '@/shared/utils/http/pagination.util.js';
import {
  CreateWebhookDto,
  listWebhookDeliveryAttemptsQueryDto,
  listWebhooksQueryDto,
  UpdateWebhookDto,
  type CreateWebhookInput,
  type ListWebhookDeliveryAttemptsQueryInput,
  type ListWebhooksQueryInput,
  type UpdateWebhookInput,
} from './webhook.dto.js';

/**
 * Reject legacy page/per_page callers, then parse the `GET /notify/webhooks` query
 * string with {@link listWebhooksQueryDto}; throws `ValidationError('errors:invalidInput')`.
 */
export function validateListWebhooksQuery(data: unknown): ListWebhooksQueryInput {
  return parseCursorPaginatedQuery(listWebhooksQueryDto, data);
}

/**
 * Reject legacy page/per_page callers, then parse the delivery-attempts list query string with
 * {@link listWebhookDeliveryAttemptsQueryDto}; throws `ValidationError('errors:invalidInput')`.
 */
export function validateListWebhookDeliveryAttemptsQuery(
  data: unknown,
): ListWebhookDeliveryAttemptsQueryInput {
  return parseCursorPaginatedQuery(listWebhookDeliveryAttemptsQueryDto, data);
}

/**
 * Parse the `POST /notify/webhooks` request body via {@link CreateWebhookDto};
 * throws `ValidationError('errors:invalidInput')` with field-level errors on failure.
 */
export function validateCreateWebhook(data: unknown): CreateWebhookInput {
  return parseWithSchema(CreateWebhookDto, data);
}

/**
 * Parse the `PATCH /notify/webhooks/:webhook_id` request body via
 * {@link UpdateWebhookDto}; throws `ValidationError('errors:invalidInput')` on failure.
 */
export function validateUpdateWebhook(data: unknown): UpdateWebhookInput {
  return parseWithSchema(UpdateWebhookDto, data);
}
