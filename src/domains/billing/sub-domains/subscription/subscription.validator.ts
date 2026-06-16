import { parseWithSchema } from '@/shared/utils/validation/parse-with-schema.util.js';
import {
  ChangePlanDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  type ChangePlanInput,
  type CreateSubscriptionInput,
  type UpdateSubscriptionInput,
} from './subscription.dto.js';

/**
 * Parses `POST /api/v1/billing/subscriptions` body against
 * {@link CreateSubscriptionDto}, throwing `ValidationError` with
 * field-level details on failure.
 */
export function validateCreateSubscription(data: unknown): CreateSubscriptionInput {
  return parseWithSchema(CreateSubscriptionDto, data);
}

/**
 * Parses the subscription PATCH body against {@link UpdateSubscriptionDto},
 * throwing `ValidationError` with field-level details on failure.
 */
export function validateUpdateSubscription(data: unknown): UpdateSubscriptionInput {
  return parseWithSchema(UpdateSubscriptionDto, data);
}

/**
 * Parses the change-plan body against {@link ChangePlanDto}, throwing
 * `ValidationError` with field-level details on failure.
 */
export function validateChangePlan(data: unknown): ChangePlanInput {
  return parseWithSchema(ChangePlanDto, data);
}
