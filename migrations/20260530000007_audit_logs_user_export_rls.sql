-- GDPR user-data-export worker reads audit.logs by actor_user_id under app.current_user_id.
-- Tenant isolation alone hides rows when no organization context is set.

DROP POLICY IF EXISTS audit_logs_user_export_select ON audit.logs;

CREATE POLICY audit_logs_user_export_select ON audit.logs
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (
    actor_user_id = (
      SELECT id
      FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );
