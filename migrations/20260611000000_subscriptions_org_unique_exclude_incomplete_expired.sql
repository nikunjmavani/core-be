-- migration-transaction: none reason="CREATE/DROP INDEX CONCURRENTLY cannot run in a transaction"
-- audit-#1: an organization could be permanently locked out of re-subscribing
-- after an abandoned checkout.
--
-- Stripe subscriptions are created with `payment_behavior: 'default_incomplete'`,
-- so EVERY new subscription starts `incomplete`; if the first payment is never
-- confirmed (~23h) Stripe transitions it to `incomplete_expired` and the webhook
-- writes local status `INCOMPLETE_EXPIRED`. That status is in the service's
-- `TERMINAL_STATUSES` (so cancel/resume/change-plan reject the row), but the
-- partial unique index and `findActiveByOrganization` excluded ONLY `CANCELED`,
-- so the expired row still occupies the single-subscription slot. Result:
-- `POST /subscriptions` returns 409 forever and `/cancel` returns 422 forever —
-- the org can never subscribe again through the API (lost revenue, no
-- programmatic exit).
--
-- Fix: treat `INCOMPLETE_EXPIRED` the same as `CANCELED` for slot occupancy, so
-- an abandoned-checkout row releases the slot. The index predicate, the repo
-- filter (`findActiveByOrganization`), and the service `TERMINAL_STATUSES` set
-- are now kept in lockstep via `INACTIVE_SUBSCRIPTION_STATUSES`.
--
-- Online + gap-free: create the replacement partial-unique index under a temp
-- name CONCURRENTLY, drop the old one CONCURRENTLY, then rename to the canonical
-- `idx_subscriptions_org` (metadata-only). There is never a window without a
-- unique constraint. Idempotent via IF [NOT] EXISTS.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_org_v2
  ON billing.subscriptions (organization_id)
  WHERE status NOT IN ('CANCELED', 'INCOMPLETE_EXPIRED');
--> statement-breakpoint

DROP INDEX CONCURRENTLY IF EXISTS billing.idx_subscriptions_org;
--> statement-breakpoint

ALTER INDEX IF EXISTS billing.idx_subscriptions_org_v2 RENAME TO idx_subscriptions_org;
