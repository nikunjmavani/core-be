-- sec-N8: webhook secret rotation overlap window.
--
-- `update()` overwrote `encrypted_secret` in place. Customer secret rotation
-- created a guaranteed retry-failure window (~3 min of BullMQ retries plus
-- whatever was already in-flight) where signatures generated with the new
-- key did not match a verifier the customer had still pinned to the old key.
--
-- This migration adds two columns:
--   - `encrypted_secret_previous` — the prior `encrypted_secret`, populated
--     atomically inside the same update that writes the new secret.
--   - `secret_rotated_at` — wall-clock stamp of the rotation so the worker
--     can dual-sign within an env-configurable overlap window
--     (`WEBHOOK_SECRET_ROTATION_OVERLAP_HOURS`, default 24h) and stop
--     dual-signing afterwards.
--
-- During the overlap, outbound deliveries carry both
-- `X-Webhook-Signature` (new key) and `X-Webhook-Signature-Previous` (old
-- key) so the customer's verifier can accept either while they roll their
-- rotation. Beyond the window the worker stops emitting the previous header;
-- the column value is left in place (no sweeper required for this LOW
-- finding — re-rotation simply overwrites it).
--
-- Idempotent on re-run (the harness wipes schema_migrations and re-runs
-- migrations): both columns use `IF NOT EXISTS`, both statements are
-- separated by `--> statement-breakpoint`.

ALTER TABLE notify.webhooks
  ADD COLUMN IF NOT EXISTS encrypted_secret_previous VARCHAR(255);
--> statement-breakpoint
ALTER TABLE notify.webhooks
  ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMPTZ;
