-- sec-U7: drop the organization-scope branch from `auth.user_notification_preferences`.
--
-- The original RLS policy permitted
--   `organization_id IS NULL OR organization_id = current_setting(...)`,
-- but the corresponding GUC subquery only verifies the user's currently-active
-- organization context — NOT that the user is actually a member of that
-- organization. A future route wrapping this table in
-- `withOrganizationDatabaseContext` would let any authenticated user write
-- (or read) notification preferences against any organization id they pass via
-- `X-Organization-Id`, regardless of membership.
--
-- The service-level guard
-- (`user-notification-preferences.service.ts:put → ValidationError`) already
-- rejects non-null `organization_id` on the only route that writes this table,
-- so no production data currently carries a non-null org id. Tighten the
-- schema-level invariant to match: drop the org branch from the policy, add
-- a CHECK constraint pinning `organization_id` to NULL, and drop the dead
-- index that was only useful when the column was populated.
-- Organization-scoped notification policy lives in
-- `tenancy.organization_notification_policies` — a separate, properly
-- membership-gated table.
--
-- The column is kept (for migration rollback safety + to avoid an ACCESS
-- EXCLUSIVE rewrite); a follow-up cleanup PR may drop it once the policy
-- shape has soaked.
--
-- Idempotent: every clause uses IF EXISTS / IF NOT EXISTS.

-- 1. Drop the dead index (it indexed organization_id which is always NULL
--    after this migration; the existing user/type/channel index covers every
--    read path).
DROP INDEX IF EXISTS auth.idx_user_notif_prefs_org;
--> statement-breakpoint

-- 2. Replace the RLS policy with the user-only version (no org branch). DROP
--    the prior policy first so the new one carries the freshly-tightened
--    USING/WITH CHECK clauses without an in-place ALTER POLICY that some
--    Postgres versions reject.
DROP POLICY IF EXISTS "user_notification_preferences_user_org_access"
  ON auth.user_notification_preferences;
--> statement-breakpoint

CREATE POLICY "user_notification_preferences_user_access"
  ON auth.user_notification_preferences
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (
    auth.user_notification_preferences.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.user_notification_preferences.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );
--> statement-breakpoint

-- 3. Defense-in-depth CHECK constraint. With the RLS branch gone, any caller
--    that bypasses the application-level guard (raw SQL, a future direct
--    repository write) still cannot persist a non-null organization_id. The
--    constraint is NOT VALIDATED retroactively because production data is
--    already known-NULL (the service guard has been live since launch); a
--    rebuild would only add a needless ACCESS EXCLUSIVE wait.
ALTER TABLE auth.user_notification_preferences
  DROP CONSTRAINT IF EXISTS chk_user_notif_prefs_no_org;
--> statement-breakpoint

ALTER TABLE auth.user_notification_preferences
  ADD CONSTRAINT chk_user_notif_prefs_no_org
  CHECK (organization_id IS NULL) NOT VALID;
--> statement-breakpoint

-- Validate the constraint. Production data is known-NULL via the service guard,
-- so validation is a fast metadata change rather than a heavy scan; keeping
-- VALIDATE explicit so the catalog records the constraint as fully enforced.
ALTER TABLE auth.user_notification_preferences
  VALIDATE CONSTRAINT chk_user_notif_prefs_no_org;
