-- migration-safety: allow set_not_null_on_existing_column reason="column is fully backfilled in the same migration above the SET NOT NULL — all existing rows receive a uuid-derived value before the constraint is applied; the migration role (neondb_owner / superuser) bypasses FORCE RLS so the UPDATE touches every row"
-- sec-new-B4: add public_id to auth.auth_methods so the auth-method management API
-- can return and accept an opaque stable identifier instead of the bigserial `id`.
-- The X-Auth-Method-* surface and DELETE /me/auth-methods/:id will migrate to
-- :publicId; the bigserial is no longer returned or accepted by the HTTP layer.

ALTER TABLE auth.auth_methods
  ADD COLUMN IF NOT EXISTS public_id varchar(28);

UPDATE auth.auth_methods
SET public_id = left(replace(gen_random_uuid()::text, '-', ''), 21)
WHERE public_id IS NULL;

ALTER TABLE auth.auth_methods
  ALTER COLUMN public_id SET NOT NULL;
