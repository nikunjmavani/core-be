/** Repository-level input for {@link SubscriptionRepository.create} — already-resolved numeric IDs. */
export interface SubscriptionCreateData {
  organization_id: number;
  plan_id: number;
  billing_cycle: string;
  status?: string;
  current_period_start: Date;
  current_period_end: Date;
  trial_end?: Date;
  created_by_user_id?: number;
  provider?: string;
  provider_subscription_id?: string;
  provider_customer_id?: string;
}

/**
 * Partial update set for {@link SubscriptionRepository.update} and the
 * webhook-driven sync paths; all fields are optional so callers can apply
 * narrow patches.
 */
export interface SubscriptionUpdateData {
  cancel_at_period_end?: boolean;
  status?: string;
  canceled_at?: Date;
  current_period_start?: Date;
  current_period_end?: Date;
  plan_id?: number;
  billing_cycle?: string;
  updated_at?: Date;
}
