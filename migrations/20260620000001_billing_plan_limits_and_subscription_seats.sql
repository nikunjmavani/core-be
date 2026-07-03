-- REQ-4 (full seat model): expose plan seat limits and per-subscription purchased seats.
--
-- Two existing tables gain one nullable column each. Both columns are NULLABLE on purpose:
--   * billing.plans.included_seats — the seat allowance baked into a plan tier. NULL means
--     "unlimited / unmetered" (the historical behaviour for every pre-existing plan), so the
--     seat-availability check is a no-op for those plans and nothing regresses on deploy.
--   * billing.subscriptions.seats — the purchased quantity synced FROM Stripe. NULL means
--     "not yet synced", in which case seats_total falls back to the plan's included_seats.
--
-- Adding a nullable column with no default is a metadata-only change in Postgres (no table
-- rewrite, no long lock) — safe online DDL. CHECK constraints are added NOT VALID first (so the
-- ADD takes no validation lock), then VALIDATEd in a follow-up step (a lighter SHARE UPDATE
-- EXCLUSIVE scan): every existing row is NULL and satisfies `>= 0`, so validation is a no-op.
--
-- RLS: neither column changes tenant isolation. billing.plans is a global catalog (no RLS
-- policy); billing.subscriptions keeps its existing `subscriptions_tenant_isolation` policy
-- unchanged — adding a non-key column does not affect the USING/WITH CHECK predicates.
--
-- Re-run safety: ADD COLUMN uses IF NOT EXISTS; the constraint ADDs are not guarded (Postgres has
-- no IF NOT EXISTS for ADD CONSTRAINT) but the migration runner applies each file at most once.

ALTER TABLE billing.plans
  ADD COLUMN IF NOT EXISTS included_seats INTEGER;
--> statement-breakpoint

ALTER TABLE billing.plans
  ADD CONSTRAINT chk_plans_included_seats
  CHECK (included_seats IS NULL OR included_seats >= 0)
  NOT VALID;
--> statement-breakpoint

ALTER TABLE billing.plans
  VALIDATE CONSTRAINT chk_plans_included_seats;
--> statement-breakpoint

ALTER TABLE billing.subscriptions
  ADD COLUMN IF NOT EXISTS seats INTEGER;
--> statement-breakpoint

ALTER TABLE billing.subscriptions
  ADD CONSTRAINT chk_subs_seats
  CHECK (seats IS NULL OR seats >= 0)
  NOT VALID;
--> statement-breakpoint

ALTER TABLE billing.subscriptions
  VALIDATE CONSTRAINT chk_subs_seats;
