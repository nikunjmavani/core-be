-- Audit hardening #7 (follow-up): FORCE RLS on auth.users and auth.auth_methods — the two sensitive
-- auth tables deliberately deferred by 20260530000003. These were left un-forced because they are
-- read in pre-session (login by email, OAuth by provider id) and cross-user admin (user listing)
-- flows that have no single user context. Forcing them safely now requires (a) a dedicated
-- global-admin database context (app.global_admin) for cross-user admin paths, and (b) pre-session
-- SECURITY DEFINER resolvers for the authentication phase that has no app.current_user_id GUC yet.
--
-- Under FORCE ROW LEVEL SECURITY the non-superuser application role (core_be_app) gets ZERO rows
-- unless a policy matches. The owner policy is keyed on app.current_user_id (set by
-- withUserDatabaseContext); the admin escape hatch is keyed on app.global_admin (set by
-- withGlobalAdminDatabaseContext, only ever entered from already-authorized admin/system code).
-- The CI test suite connects as a SUPERUSER (RLS-exempt) and will NOT catch RLS regressions — the
-- non-superuser RLS-matrix lane (src/tests/security/rls) is the safety net.

-- Defensive (idempotent) grants — these tables predate this migration, but make the application
-- role's table privileges explicit alongside the new RLS policies (mirrors 20260530000003).
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO core_be_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.auth_methods TO core_be_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- auth.users — canonical identity table. Owner branch: a user may read/write only
-- its own non-deleted row (public_id = app.current_user_id). Admin branch: the
-- global-admin context (app.global_admin = 'true') sees and mutates every row
-- (admin listing, suspend, soft-delete). Admin paths are gated by requireRole at
-- the HTTP layer before withGlobalAdminDatabaseContext is entered.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_self_or_admin_access ON auth.users;
CREATE POLICY users_self_or_admin_access ON auth.users
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    (
      auth.users.public_id = current_setting('app.current_user_id', true)
      AND auth.users.deleted_at IS NULL
    )
    OR current_setting('app.global_admin', true) = 'true'
  )
  WITH CHECK (
    auth.users.public_id = current_setting('app.current_user_id', true)
    OR current_setting('app.global_admin', true) = 'true'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- auth.auth_methods — one row per linked credential. Ownership is derived through
-- auth.users: the SELECT id FROM auth.users subquery is itself subject to the
-- auth.users owner policy above, so it returns the owning row only when
-- app.current_user_id matches (the two policies compose). The admin branch mirrors
-- auth.users so the global-admin context can read/write any credential row.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE auth.auth_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.auth_methods FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS auth_methods_self_or_admin_access ON auth.auth_methods;
CREATE POLICY auth_methods_self_or_admin_access ON auth.auth_methods
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    auth.auth_methods.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
    OR current_setting('app.global_admin', true) = 'true'
  )
  WITH CHECK (
    auth.auth_methods.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
    OR current_setting('app.global_admin', true) = 'true'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Pre-session authentication resolvers (SECURITY DEFINER, RLS bypass by ownership).
-- These run during the authentication phase, before any user context is
-- established, so a plain SELECT under FORCE RLS would return zero rows and reject
-- every valid login. Each returns only what the corresponding caller needs and is
-- EXECUTE-granted to core_be_app. Mirror tenancy.resolve_api_key_for_authentication.
-- ─────────────────────────────────────────────────────────────────────────────

-- Login / forgot-password / webauthn auth-options / OAuth find-or-create look the
-- user up by email with no user context — returns the full identity row (including
-- password_hash) the authentication services already consumed.
CREATE OR REPLACE FUNCTION auth.resolve_user_for_authentication_by_email (
  email_param TEXT
) RETURNS SETOF auth.users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT *
  FROM auth.users
  WHERE email = email_param
    AND deleted_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION auth.resolve_user_for_authentication_by_email (TEXT) TO core_be_app;

-- Token-consume flows (magic-link verify, password reset, email verify) and session
-- refresh resolve the user by the internal id stored on the token/session row, again
-- before any user context exists. Mirrors the old findById (no deleted_at filter).
CREATE OR REPLACE FUNCTION auth.resolve_user_by_internal_id (
  id_param BIGINT
) RETURNS SETOF auth.users
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT *
  FROM auth.users
  WHERE id = id_param
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION auth.resolve_user_by_internal_id (BIGINT) TO core_be_app;

-- OAuth callback resolves an existing linked credential by (provider, provider_user_id)
-- with no user context. Returns the auth_method row plus the owning user's public_id so
-- the caller can enter withUserDatabaseContext for any follow-up owner-scoped work.
CREATE OR REPLACE FUNCTION auth.resolve_auth_method_by_provider (
  provider_param TEXT,
  provider_user_id_param TEXT
) RETURNS TABLE (
  id BIGINT,
  user_id BIGINT,
  user_public_id TEXT,
  method_type TEXT,
  provider TEXT,
  provider_user_id TEXT,
  is_primary BOOLEAN,
  verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT
    auth_method_row.id AS id,
    auth_method_row.user_id AS user_id,
    user_row.public_id::text AS user_public_id,
    auth_method_row.method_type::text AS method_type,
    auth_method_row.provider::text AS provider,
    auth_method_row.provider_user_id::text AS provider_user_id,
    auth_method_row.is_primary AS is_primary,
    auth_method_row.verified_at AS verified_at,
    auth_method_row.last_used_at AS last_used_at,
    auth_method_row.created_at AS created_at,
    auth_method_row.revoked_at AS revoked_at
  FROM auth.auth_methods AS auth_method_row
  INNER JOIN auth.users AS user_row
    ON user_row.id = auth_method_row.user_id
  WHERE auth_method_row.provider = provider_param
    AND auth_method_row.provider_user_id = provider_user_id_param
    AND auth_method_row.revoked_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION auth.resolve_auth_method_by_provider (TEXT, TEXT) TO core_be_app;
