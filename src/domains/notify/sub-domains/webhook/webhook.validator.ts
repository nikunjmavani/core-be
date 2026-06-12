import { z } from 'zod';
import { ValidationError } from '@/shared/errors/index.js';
import { ensureCursorOnlyPagination } from '@/shared/utils/http/pagination.util.js';
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
 * Reject legacy page/per_page callers, then parse the `GET /organizations/:organization_id/webhooks` query
 * string with {@link listWebhooksQueryDto}; throws `ValidationError('errors:invalidInput')`.
 */
export function validateListWebhooksQuery(data: unknown): ListWebhooksQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listWebhooksQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/**
 * Reject legacy page/per_page callers, then parse the delivery-attempts list query string with
 * {@link listWebhookDeliveryAttemptsQueryDto}; throws `ValidationError('errors:invalidInput')`.
 */
export function validateListWebhookDeliveryAttemptsQuery(
  data: unknown,
): ListWebhookDeliveryAttemptsQueryInput {
  ensureCursorOnlyPagination(data);
  const result = listWebhookDeliveryAttemptsQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/**
 * Parse the `POST /organizations/:organization_id/webhooks` request body via {@link CreateWebhookDto};
 * throws `ValidationError('errors:invalidInput')` with field-level errors on failure.
 */
export function validateCreateWebhook(data: unknown): CreateWebhookInput {
  const result = CreateWebhookDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}

/**
 * Parse the `PATCH /organizations/:organization_id/webhooks/:webhook_id` request body via
 * {@link UpdateWebhookDto}; throws `ValidationError('errors:invalidInput')` on failure.
 */
export function validateUpdateWebhook(data: unknown): UpdateWebhookInput {
  const result = UpdateWebhookDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      'errors:invalidInput',
      undefined,
      z.flattenError(result.error).fieldErrors,
    );
  }
  return result.data;
}
