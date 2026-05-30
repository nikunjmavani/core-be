-- Audit hardening #3 + #7: FORCE RLS on auth credential / MFA / passkey / settings / export
-- tables (real cross-user isolation, not just app-layer WHERE user_id = ?) and a SECURITY DEFINER
-- resolver for API-key authentication so the pre-session, org-context-less auth phase can still
-- look a key up under FORCE RLS.
--
-- Background:
--   * #3 — api-key auth runs before any tenant transaction (DATABASE_RLS_SCOPED_CONTEXTS=true
--     disables the per-request org-RLS transaction), so no app.current_organization_id GUC is set.
--     tenancy.api_keys is FORCE RLS, so a plain SELECT resolves the policy predicate to NULL and
--     returns zero rows — every valid key is rejected in production (CI passes only because tests
--     connect as a superuser, which is RLS-exempt). A narrow SECURITY DEFINER resolver mirrors the
--     existing tenancy.resolve_member_invitation_lookup_by_public_id /
--     billing.resolve_organization_public_id_for_stripe_subscription pattern and returns the
--     candidate row(s) plus the owning organization public id (so the auth phase never has to read
--     tenancy.organizations, which is also FORCE RLS).
--
--   * #7 — the most sensitive per-user tables (TOTP seeds, recovery codes, passkeys, settings,
--     GDPR export rows) previously had ZERO RLS; cross-user isolation rested entirely on the
--     application's WHERE user_id = ? clauses. Add a user-scoped owner-access policy keyed on
--     app.current_user_id, mirroring the existing auth.sessions_user_access / uploads_owner_access
--     pattern. Every read/write path for these tables knows the owning user's public id at the call
--     site (authenticated request, MFA session, or WebAuthn challenge) and now runs inside
--     withUserDatabaseContext, which sets app.current_user_id. The data-export retention worker runs
--     under withGlobalRetentionCleanupDatabaseContext, so its owner policy keeps the
--     app.global_retention_cleanup escape hatch.
--
--   auth.users and auth.auth_methods are intentionally NOT forced here: they are read in
--   pre-session (login by email, OAuth by provider id, the JWT auth middleware) and cross-user admin
--   (user listing) flows that have no single user context, so forcing them safely requires a
--   dedicated global-admin database context plus pre-session resolvers — tracked as a follow-up.

-- ─────────────────────────────────────────────────────────────────────────────
-- #3 — API-key authentication resolver (SECURITY DEFINER, RLS bypass by ownership)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tenancy.resolve_api_key_for_authentication (
  key_prefix_param TEXT
) RETURNS TABLE (
  public_id TEXT,
  organization_id BIGINT,
  organization_public_id TEXT,
  key_hash TEXT,
  scopes JSONB,
  status TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenancy, public
AS $$
  SELECT
    api_key_row.public_id::text AS public_id,
    api_key_row.organization_id AS organization_id,
    organization_row.public_id::text AS organization_public_id,
    api_key_row.key_hash::text AS key_hash,
    api_key_row.scopes AS scopes,
    api_key_row.status::text AS status,
    api_key_row.expires_at AS expires_at
  FROM tenancy.api_keys AS api_key_row
  INNER JOIN tenancy.organizations AS organization_row
    ON organization_row.id = api_key_row.organization_id
  WHERE api_key_row.key_prefix = key_prefix_param
    AND api_key_row.status = 'ACTIVE'
    AND api_key_row.deleted_at IS NULL
    AND organization_row.deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION tenancy.resolve_api_key_for_authentication (TEXT) TO core_be_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- #7 — User-scoped FORCE RLS on credential / MFA / settings / export tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Defensive (idempotent) grants — these tables predate this migration, but make the
-- application role's table privileges explicit alongside the new RLS policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.user_settings TO core_be_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.mfa_methods TO core_be_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.mfa_recovery_codes TO core_be_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.webauthn_credentials TO core_be_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.user_data_exports TO core_be_app;

-- auth.user_settings — singleton row per user (PK = user_id).
ALTER TABLE auth.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.user_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_owner_access ON auth.user_settings;
CREATE POLICY user_settings_owner_access ON auth.user_settings
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    auth.user_settings.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.user_settings.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );

-- auth.mfa_methods — dedicated MFA factor table (TOTP seeds, etc.).
ALTER TABLE auth.mfa_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.mfa_methods FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfa_methods_owner_access ON auth.mfa_methods;
CREATE POLICY mfa_methods_owner_access ON auth.mfa_methods
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    auth.mfa_methods.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.mfa_methods.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );

-- auth.mfa_recovery_codes — one-time recovery codes (hashed at rest).
ALTER TABLE auth.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.mfa_recovery_codes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfa_recovery_codes_owner_access ON auth.mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_owner_access ON auth.mfa_recovery_codes
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    auth.mfa_recovery_codes.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.mfa_recovery_codes.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );

-- auth.webauthn_credentials — registered passkeys (public key, signature counter).
ALTER TABLE auth.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.webauthn_credentials FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webauthn_credentials_owner_access ON auth.webauthn_credentials;
CREATE POLICY webauthn_credentials_owner_access ON auth.webauthn_credentials
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    auth.webauthn_credentials.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  )
  WITH CHECK (
    auth.webauthn_credentials.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );

-- auth.user_data_exports — GDPR export rows. Owner access for HTTP / worker generation;
-- the global-retention escape lets the retention worker purge expired rows cross-user.
ALTER TABLE auth.user_data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.user_data_exports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_data_exports_owner_access ON auth.user_data_exports;
CREATE POLICY user_data_exports_owner_access ON auth.user_data_exports
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    auth.user_data_exports.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
    OR current_setting('app.global_retention_cleanup', true) = 'true'
  )
  WITH CHECK (
    auth.user_data_exports.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
    OR current_setting('app.global_retention_cleanup', true) = 'true'
  );
