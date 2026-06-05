-- Login-time / pre-tenant-context resolvers for organization settings.
--
-- `tenancy.memberships` and `tenancy.organization_settings` are FORCE ROW LEVEL
-- SECURITY. The org-mandated-MFA enforcement check and the org default-locale
-- lookup both run during the authentication phase -- BEFORE any
-- `app.current_organization_id` / `app.current_user_id` GUC is set. A plain
-- SELECT under the non-superuser `core_be_app` role therefore resolves every
-- tenant-isolation policy to NULL and returns ZERO rows. In production this
-- silently disabled organization-mandated MFA (the check always returned
-- `false`, so users who had not personally enrolled were issued a JWT without a
-- second factor) and forced the org default locale to fall back to `en`.
--
-- These SECURITY DEFINER resolvers bypass RLS by ownership -- the exact pattern
-- already used by `tenancy.resolve_api_key_for_authentication` and
-- `auth.resolve_user_id_by_public_id` for other pre-session lookups. They are
-- intentionally narrow (a boolean / a single locale string) and own no write
-- surface. Not visible in local/CI because those run as the RLS-exempt
-- `postgres` superuser; a non-superuser regression test pins the behaviour.

-- ─────────────────────────────────────────────────────────────────────────────
-- Organization-mandated MFA check (SECURITY DEFINER, RLS bypass by ownership)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tenancy.user_has_organization_requiring_mfa (
  user_id_param BIGINT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenancy, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenancy.memberships AS membership_row
    INNER JOIN tenancy.organization_settings AS settings_row
      ON settings_row.organization_id = membership_row.organization_id
    WHERE membership_row.user_id = user_id_param
      AND membership_row.status = 'ACTIVE'
      AND membership_row.deleted_at IS NULL
      -- Match the application's strict `securityPolicy.mfa_required === true`
      -- (JSON boolean true only, not the string "true").
      AND (settings_row.security_policy -> 'mfa_required') = 'true'::jsonb
  );
$$;

GRANT EXECUTE ON FUNCTION tenancy.user_has_organization_requiring_mfa (BIGINT) TO core_be_app;

-- ─────────────────────────────────────────────────────────────────────────────
-- Organization default-locale resolver (SECURITY DEFINER, RLS bypass by ownership)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tenancy.resolve_organization_default_locale (
  organization_public_id_param TEXT
) RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenancy, public
AS $$
  SELECT settings_row.default_locale::text
  FROM tenancy.organization_settings AS settings_row
  INNER JOIN tenancy.organizations AS organization_row
    ON organization_row.id = settings_row.organization_id
  WHERE organization_row.public_id = organization_public_id_param
    AND organization_row.deleted_at IS NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION tenancy.resolve_organization_default_locale (TEXT) TO core_be_app;
