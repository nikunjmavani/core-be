-- Production hardening item 2: user-scoped RLS for in-app notifications.
-- NotificationService reads/writes by user_id (a user's own notifications), but the existing
-- notifications_tenant_isolation policy is org-scoped. Add a permissive owner-access policy
-- keyed on app.current_user_id so owners can see their notifications. Permissive policies are
-- OR'd, so org-scoped and global-retention access are unchanged; inert until a context sets
-- app.current_user_id (via withUserDatabaseContext).

DROP POLICY IF EXISTS notifications_owner_access ON notify.notifications;
CREATE POLICY notifications_owner_access ON notify.notifications
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    notify.notifications.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );
