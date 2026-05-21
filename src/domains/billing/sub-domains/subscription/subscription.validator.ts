import { ValidationError } from '@/shared/errors/index.js';
import {
  ChangePlanDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  type ChangePlanInput,
  type CreateSubscriptionInput,
  type UpdateSubscriptionInput,
} from './subscription.dto.js';

export function validateCreateSubscription(data: unknown): CreateSubscriptionInput {
  const result = CreateSubscriptionDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateUpdateSubscription(data: unknown): UpdateSubscriptionInput {
  const result = UpdateSubscriptionDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

export function validateChangePlan(data: unknown): ChangePlanInput {
  const result = ChangePlanDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
