/** Repository-level input for {@link SubscriptionRepository.create} — already-resolved numeric IDs. */
export interface SubscriptionCreateData {
  organization_id: number;
  plan_id: number;
  billing_cycle: string;
  status?: string;
  current_period_start: Date;
  current_period_end: Date;
  trial_end?: Date;
  /**
   * Set only by the Stripe `customer.subscription.deleted` tombstone path
   * (audit-#1) when materialising a CANCELED row whose local subscription never
   * existed. The regular create paths leave this unset (defaults to `NULL`).
   */
  canceled_at?: Date;
  /**
   * Set alongside {@link canceled_at} on the deletion tombstone path so the
   * CANCELED row is unambiguously terminal. Defaults to `false` for every other
   * create path.
   */
  cancel_at_period_end?: boolean;
  created_by_user_id?: number;
  provider?: string;
  provider_subscription_id?: string;
  provider_customer_id?: string;
  /**
   * Initial watermark for the Stripe-event reconciliation guard. Set to `new Date()`
   * by the HTTP `create()` path when Stripe accepted the subscription (sec-B2) so a
   * late-arriving `customer.subscription.created` whose `created` timestamp is older
   * than this value cannot clobber the row. Unset when Stripe is not configured.
   */
  last_stripe_event_created_at?: Date;
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
  /**
   * Set by HTTP-side mutations (`cancel`/`resume`/`changePlan`) to `new Date()` so a
   * stale Stripe event delivered later cannot regress the row state (sec-B3). The
   * webhook-driven `syncFromStripeProviderSubscription` path sets this from the event's
   * own `created` timestamp instead — both write through the same column but only the
   * HTTP path uses the current wall clock.
   */
  last_stripe_event_created_at?: Date;
}
