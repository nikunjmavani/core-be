-- Rotating refresh cookie credential (separate from access-token hash).

ALTER TABLE auth.sessions
  ADD COLUMN IF NOT EXISTS refresh_token_hash varchar(64);

DROP POLICY IF EXISTS sessions_user_access ON auth.sessions;

CREATE POLICY sessions_user_access ON auth.sessions
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    user_id = (
      SELECT id
      FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
    OR public_id = current_setting('app.current_session_public_id', true)
    OR token_hash = current_setting('app.current_session_token_hash', true)
    OR refresh_token_hash = current_setting('app.current_session_refresh_token_hash', true)
    OR current_setting('app.session_retention_cleanup', true) = 'true'
  )
  WITH CHECK (
    user_id = (
      SELECT id
      FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
    OR public_id = current_setting('app.current_session_public_id', true)
    OR token_hash = current_setting('app.current_session_token_hash', true)
    OR refresh_token_hash = current_setting('app.current_session_refresh_token_hash', true)
    OR current_setting('app.session_retention_cleanup', true) = 'true'
  );
