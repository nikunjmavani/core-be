-- migration-safety: allow set_not_null_on_existing_column reason="column is fully backfilled in the same migration above the SET NOT NULL — all existing rows receive a uuid-derived value before the constraint is applied"
-- sec-new-B2: add public_id to notify.webhook_delivery_attempts so the
-- X-Webhook-Delivery-Id outbound header carries an opaque 21-char identifier
-- instead of exposing the bigserial primary key, which would let receivers
-- infer table cardinality or enumerate delivery attempts by guessing.
--
-- Approach:
--   1. Add the column as nullable so existing rows are not immediately rejected.
--   2. Backfill all existing rows with a uuid-derived value.  gen_random_uuid() is
--      built into Postgres 13+ (no extension required); hex-stripping the dashes
--      and taking the first 21 chars gives adequate uniqueness for a one-time
--      backfill (2^84 possibilities, collision probability negligible for table
--      cardinalities seen in practice).
--   3. ALTER COLUMN … SET NOT NULL — safe because every row was backfilled above.
--
-- The unique index is created in the follow-up migration
-- 20260608030000_webhook_delivery_attempts_public_id_index.sql using
-- CREATE UNIQUE INDEX CONCURRENTLY (requires its own non-transactional migration).

ALTER TABLE notify.webhook_delivery_attempts
  ADD COLUMN IF NOT EXISTS public_id varchar(21);

UPDATE notify.webhook_delivery_attempts
SET public_id = left(replace(gen_random_uuid()::text, '-', ''), 21)
WHERE public_id IS NULL;

ALTER TABLE notify.webhook_delivery_attempts
  ALTER COLUMN public_id SET NOT NULL;
