-- BILL-03: durable deletion watermark for Stripe subscriptions.
--
-- Background:
--   When `customer.subscription.deleted` arrives BEFORE the local
--   `billing.subscriptions` row exists (Stripe delivery reorder), the handler
--   found no row to cancel, logged "stale_or_missing", and marked the ledger row
--   processed. A later `customer.subscription.created` then inserted a fresh
--   ACTIVE row via the sec-B9 fallback path — resurrecting entitlement for a
--   subscription Stripe had already deleted. The existing
--   `last_stripe_event_created_at` watermark only protects UPDATEs to an existing
--   row, so it could not guard the create-after-delete case (no row to compare).
--
--   This table records the deleted event's timestamp keyed by the Stripe
--   subscription id. The create/update handler consults it: a create/update whose
--   event timestamp is <= the recorded deletion is refused (the delete wins), a
--   strictly-newer event (genuine resubscription) is allowed through.
--
--   System-ingress table (no tenant RLS), mirroring billing.stripe_webhook_events.

CREATE TABLE IF NOT EXISTS billing.stripe_subscription_tombstones (
  provider_subscription_id VARCHAR(255) PRIMARY KEY,
  deleted_event_created_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON billing.stripe_subscription_tombstones TO core_be_app;
--> statement-breakpoint

-- Defense in depth (mirrors migration 20260520000001 for stripe_webhook_events):
-- a system table without tenant RLS still gets deny-all + role-scoped policies so
-- only the app role (via explicit GRANT + policy) can touch it.
ALTER TABLE billing.stripe_subscription_tombstones ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE billing.stripe_subscription_tombstones FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS stripe_subscription_tombstones_deny_all ON billing.stripe_subscription_tombstones;
--> statement-breakpoint
CREATE POLICY stripe_subscription_tombstones_deny_all ON billing.stripe_subscription_tombstones
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);
--> statement-breakpoint

DROP POLICY IF EXISTS stripe_subscription_tombstones_app_access ON billing.stripe_subscription_tombstones;
--> statement-breakpoint
CREATE POLICY stripe_subscription_tombstones_app_access ON billing.stripe_subscription_tombstones
  AS PERMISSIVE
  FOR ALL
  TO core_be_app
  USING (true)
  WITH CHECK (true);
