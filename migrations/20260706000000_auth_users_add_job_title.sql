-- Add an optional free-text `job_title` to auth.users so the self-service profile
-- update (PATCH /api/v1/users/me) and onboarding can persist the caller's role
-- alongside the existing first_name / last_name fields. Nullable with no default,
-- so the additive column is a metadata-only change (no table rewrite, no backfill).

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS job_title varchar(150);
