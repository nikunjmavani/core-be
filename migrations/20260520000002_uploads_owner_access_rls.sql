-- Production hardening item 2: user-scoped RLS for uploads.
-- Avatars and other user-owned uploads have organization_id IS NULL, so the org-scoped
-- uploads_tenant_isolation policy never matches them. Add a permissive owner-access policy
-- keyed on app.current_user_id (mirrors auth.user_notification_preferences). Permissive
-- policies are OR'd together, so this only GRANTS owner visibility and never restricts the
-- existing org-scoped access. It is inert until a request/worker sets app.current_user_id
-- (via withUserDatabaseContext), so it is a no-op on its own.

DROP POLICY IF EXISTS uploads_owner_access ON upload.uploads;
CREATE POLICY uploads_owner_access ON upload.uploads
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    upload.uploads.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );
