-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- audit #15: the reclaim sweep (findReclaimableStripeEventIds) and the
-- failed-count gauge (countFailedEvents) only ever touch `failed` and in-flight
-- `processing` ledger rows, ordered by updated_at. The existing
-- idx_stripe_webhook_events_status_updated covers all four statuses, so it keeps
-- indexing the bulk `processed` / `skipped_duplicate` rows that the retention
-- worker prunes — bloating the index and the reclaim sort as the ledger grows.
--
-- This partial index covers only the live working set, so the reclaim scan and
-- the capped failed-count stay index-only over a tiny set regardless of total
-- ledger volume. Predicate kept in lockstep with the reclaim/count repository
-- queries (processing_status IN ('failed','processing')). The full status_updated
-- index is intentionally retained: the retention delete filters
-- processing_status IN ('processed','skipped_duplicate') AND updated_at < cutoff,
-- which this partial index does not serve.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stripe_webhook_events_reclaimable
  ON billing.stripe_webhook_events (updated_at)
  WHERE processing_status IN ('failed', 'processing');
