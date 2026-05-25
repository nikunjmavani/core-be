import { ValidationError } from '@/shared/errors/index.js';
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

export function validateListWebhooksQuery(data: unknown): ListWebhooksQueryInput {
  const result = listWebhooksQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateListWebhookDeliveryAttemptsQuery(
  data: unknown,
): ListWebhookDeliveryAttemptsQueryInput {
  const result = listWebhookDeliveryAttemptsQueryDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateCreateWebhook(data: unknown): CreateWebhookInput {
  const result = CreateWebhookDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateUpdateWebhook(data: unknown): UpdateWebhookInput {
  const result = UpdateWebhookDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
