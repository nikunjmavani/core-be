import { ValidationError } from '@/shared/errors/index.js';
import {
  ChangePlanDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  type ChangePlanInput,
  type CreateSubscriptionInput,
  type UpdateSubscriptionInput,
} from './subscription.dto.js';

/**
 * Parses `POST /api/v1/organizations/:id/subscriptions` body against
 * {@link CreateSubscriptionDto}, throwing {@link ValidationError} with
 * field-level details on failure.
 */
export function validateCreateSubscription(data: unknown): CreateSubscriptionInput {
  const result = CreateSubscriptionDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

/**
 * Parses the subscription PATCH body against {@link UpdateSubscriptionDto},
 * throwing {@link ValidationError} with field-level details on failure.
 */
export function validateUpdateSubscription(data: unknown): UpdateSubscriptionInput {
  const result = UpdateSubscriptionDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}

/**
 * Parses the change-plan body against {@link ChangePlanDto}, throwing
 * {@link ValidationError} with field-level details on failure.
 */
export function validateChangePlan(data: unknown): ChangePlanInput {
  const result = ChangePlanDto.safeParse(data);
  if (!result.success) {
    throw new ValidationError('errors:invalidInput', undefined, result.error.flatten().fieldErrors);
  }
  return result.data;
}
