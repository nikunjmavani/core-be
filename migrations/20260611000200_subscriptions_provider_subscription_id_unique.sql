-- migration-transaction: none reason="CREATE/DROP INDEX CONCURRENTLY cannot run in a transaction"
-- audit-#10: billing.subscriptions.provider_subscription_id (the Stripe subscription
-- id, globally unique by definition) had only a NON-unique partial index, so a
-- create-race or a duplicated webhook insert could record two local rows for one
-- Stripe subscription. The resolver masks that with LIMIT 1, silently routing
-- updates/cancellations to one arbitrary row and leaving the other live. Replace the
-- non-unique index with a partial UNIQUE one — defense-in-depth on top of the
-- existing per-org single-active-subscription constraint (idx_subscriptions_org).
--
-- PREREQUISITE: no pre-existing duplicate non-null provider_subscription_id values
-- (the per-org partial-unique already prevents two active rows per org). If a
-- duplicate exists, the CONCURRENTLY build leaves an INVALID index and the migration
-- runner fails loudly — dedupe the rows, then re-run. No data is mutated by this
-- migration. Idempotent via IF [NOT] EXISTS.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_provider_subscription_id_unique
  ON billing.subscriptions (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;
--> statement-breakpoint

DROP INDEX CONCURRENTLY IF EXISTS billing.idx_subscriptions_provider_subscription_id;
