-- migration-safety: allow set_not_null_on_existing_column reason="column is fully backfilled in the same migration above the SET NOT NULL — every existing row receives a uuid-derived wac_-prefixed value before the constraint is applied; the migration role (neondb_owner / superuser) bypasses FORCE RLS so the UPDATE touches every row"
-- audit R5b / M3: add public_id to auth.webauthn_credentials so the new passkey-management API
-- (GET /auth/me/webauthn/credentials, DELETE /auth/me/webauthn/credentials/:credential_id) can
-- return and accept an opaque stable identifier instead of the bigserial `id` or the raw WebAuthn
-- `credential_id` (a long, non-Paddle-style base64url blob). New rows are minted by the app via
-- generatePublicId('webauthnCredential') => `wac_<21 [a-z0-9]>`.
--
-- Backfill: gen_random_uuid() hex is [0-9a-f] ⊂ [a-z0-9], so `'wac_' || left(...21)` satisfies the
-- public-id regex `^wac_[a-z0-9]{21}$`. Each row's UPDATE re-evaluates gen_random_uuid(), so every
-- backfilled value is distinct (the unique index below would otherwise reject a collision).
--
-- RLS: webauthn_credentials is FORCE RLS keyed on app.current_user_id; adding a non-key column does
-- not touch the `webauthn_credentials_owner_access` USING/WITH CHECK predicates.
--
-- The matching unique index is added in the follow-up migration 20260621030100 with
-- CREATE INDEX CONCURRENTLY (which cannot run inside this transactional migration) — mirroring the
-- auth_methods public_id split.
--
-- Re-run safety: ADD COLUMN uses IF NOT EXISTS; the migration runner applies each file at most once.

ALTER TABLE auth.webauthn_credentials
  ADD COLUMN IF NOT EXISTS public_id varchar(28);
--> statement-breakpoint

UPDATE auth.webauthn_credentials
SET public_id = 'wac_' || left(replace(gen_random_uuid()::text, '-', ''), 21)
WHERE public_id IS NULL;
--> statement-breakpoint

ALTER TABLE auth.webauthn_credentials
  ALTER COLUMN public_id SET NOT NULL;
