-- Mark account/org lifecycle as in-progress before external side effects run.

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz;

ALTER TABLE tenancy.organizations
  ADD COLUMN IF NOT EXISTS deletion_started_at timestamptz;
