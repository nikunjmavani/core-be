-- migration-transaction: none reason="CREATE UNIQUE INDEX CONCURRENTLY cannot run in a transaction"
-- reaudit-#4: give auth.mail_outbox an optional idempotency key. The notification worker's
-- durability-first email dedup used a non-atomic Redis GET-then-SET marker, so two concurrent
-- runs of the same notification (a stalled job redelivered to another worker while the original
-- is still running) both passed the GET and both inserted a distinct outbox row → two emails
-- (each row carries a distinct Resend Idempotency-Key `mail-outbox-<id>`, so Resend does not
-- dedupe them). A DB-level partial-unique on dedupe_key makes the insert idempotent: the second
-- producer's ON CONFLICT DO NOTHING resolves to the existing row, so both runs dispatch the SAME
-- outbox id → one email, with no lost-email risk (the insert is always attempted).
--
-- Adding a nullable column is instant (no table rewrite); the partial unique covers only rows
-- that opt in (dedupe_key IS NOT NULL), so all existing/other email paths are unaffected.

ALTER TABLE auth.mail_outbox ADD COLUMN IF NOT EXISTS dedupe_key varchar(255);
--> statement-breakpoint

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_outbox_dedupe_key
  ON auth.mail_outbox (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
