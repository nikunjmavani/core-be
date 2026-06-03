-- DLQ auto-retry starvation fix.
--
-- The auto-retry sweeper scans audit.dead_letter_jobs ordered by failed_at ASC with a small LIMIT,
-- and the retry budget lives only in a per-row Redis counter (30-day TTL). Once the oldest rows
-- exhaust their budget they are re-fetched every tick, skipped, and never make room for newer
-- replayable rows beyond the LIMIT — automated recovery of newer transient failures silently
-- stops. After the Redis counter's TTL expires, a genuinely-poison row even replays again.
--
-- Add a durable `auto_retry_resolved_at` marker. The sweeper stamps a row once its budget is
-- exhausted (or it is otherwise resolved), and the scan filters those rows out so the head of the
-- queue can never be permanently blocked and a poison row cannot be replayed after the counter
-- expires. Nullable column (NULL = still auto-retry-eligible); no backfill needed.

ALTER TABLE audit.dead_letter_jobs
  ADD COLUMN IF NOT EXISTS auto_retry_resolved_at TIMESTAMPTZ;
