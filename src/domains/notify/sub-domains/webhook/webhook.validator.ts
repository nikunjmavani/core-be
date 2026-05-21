import { ValidationError } from '@/shared/errors/index.js';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  type CreateWebhookInput,
  type UpdateWebhookInput,
} from './webhook.dto.js';

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
