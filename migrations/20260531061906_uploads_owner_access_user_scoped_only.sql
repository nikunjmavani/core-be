-- Audit finding #4: restrict uploads_owner_access to user-scoped (NULL organization_id) rows only.
-- Org-scoped uploads must be accessed under app.current_organization_id via uploads_tenant_isolation
-- (and application-layer org permission checks), not via the uploader's user_id after membership loss.

DROP POLICY IF EXISTS uploads_owner_access ON upload.uploads;
CREATE POLICY uploads_owner_access ON upload.uploads
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    upload.uploads.organization_id IS NULL
    AND upload.uploads.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );
