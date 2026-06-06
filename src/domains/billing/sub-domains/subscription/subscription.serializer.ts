/**
 * Subscription row fields exposed to API consumers. Mirrors the live Drizzle row but with
 * the public-id rename baked in and every leak-class field excluded — see sec-T finding #17.
 */
interface SubscriptionRow {
  public_id: string;
  status: string;
  billing_cycle: string;
  current_period_start: Date | string;
  current_period_end: Date | string;
  trial_end: Date | string | null;
  cancel_at_period_end: boolean;
  canceled_at: Date | string | null;
  provider: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeOne<T extends SubscriptionRow>(row: T) {
  return {
    // sec-T #17: emit the 21-char public_id, NOT the internal bigserial. The
    // bigserial `id`, the bigserial `organization_id`, the bigserial `plan_id`,
    // the bigserial `created_by_user_id` / `updated_by_user_id`, the Stripe-side
    // `provider_subscription_id` / `provider_customer_id`, and the internal
    // `last_stripe_event_created_at` watermark are all DROPPED — they leak
    // platform growth (sequential ids), correlate to Stripe customer activity
    // (Stripe SDKs treat `cus_*`/`sub_*` as private), and reveal worker
    // ordering state. Public consumers join on `public_id` only.
    id: row.public_id,
    status: row.status,
    billing_cycle: row.billing_cycle,
    current_period_start: toIsoString(row.current_period_start),
    current_period_end: toIsoString(row.current_period_end),
    trial_end: toIsoString(row.trial_end),
    cancel_at_period_end: row.cancel_at_period_end,
    canceled_at: toIsoString(row.canceled_at),
    // Provider is kept as a string literal (e.g. `"stripe"`) so callers can
    // route conditional UI without ever seeing the Stripe object ids.
    provider: row.provider,
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/**
 * Strip-only response serializer for `billing.subscriptions` rows that drops every
 * internal bigserial, every Stripe-side id, and the watermark column before reaching
 * the client (sec-T finding #17 — replaces the prior identity passthrough).
 */
export const SubscriptionSerializer = {
  one(row: SubscriptionRow) {
    return serializeOne(row);
  },
  many(rows: readonly SubscriptionRow[]) {
    return rows.map((row) => serializeOne(row));
  },
};
