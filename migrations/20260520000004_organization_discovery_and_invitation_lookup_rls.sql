-- Production hardening item 2 (continued): make DATABASE_RLS_SCOPED_CONTEXTS=true safe
-- for cross-organization and user-driven invitation routes.
--
-- Background:
--   With DATABASE_RLS_SCOPED_CONTEXTS=true the per-request organization RLS transaction
--   middleware is bypassed and services must wrap their unit-of-work in
--   withOrganizationDatabaseContext (or withUserDatabaseContext). Two categories of routes
--   could not be wrapped in a single-organization context:
--
--     1. Organization cross-organization / pre-creation reads — list, getByPublicId,
--        getBySlug, create — where no single app.current_organization_id can match.
--
--     2. Invitation accept / decline / listPending — public or user-driven routes that
--        have only an invitation_public_id or the user's email, no organization context.
--
--   This migration unblocks both classes without weakening tenant isolation:
--
--     * A new PERMISSIVE companion policy on tenancy.organizations and tenancy.memberships
--       grants USING/WITH CHECK access ONLY when app.current_user_id is set AND the user is
--       the organization owner or an active member. Permissive policies are OR'd, so the
--       existing organizations_tenant_isolation policy continues to gate org-context paths.
--
--     * Two SECURITY DEFINER helper functions resolve an invitation_public_id (or an email
--       address) to the owning organization_public_id, mirroring the existing
--       billing.resolve_organization_public_id_for_stripe_subscription pattern. The service
--       layer then wraps the actual UPDATE in withOrganizationDatabaseContext so RLS sees
--       the org GUC for the accept / revoke writes.

DROP POLICY IF EXISTS organizations_user_discovery ON tenancy.organizations;
CREATE POLICY organizations_user_discovery ON tenancy.organizations
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.current_user_id', true) IS NOT NULL
    AND current_setting('app.current_user_id', true) <> ''
    AND (
      tenancy.organizations.owner_user_id = (
        SELECT id FROM auth.users
        WHERE public_id = current_setting('app.current_user_id', true)
          AND deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM tenancy.memberships AS member_row
        WHERE member_row.organization_id = tenancy.organizations.id
          AND member_row.status = 'ACTIVE'
          AND member_row.deleted_at IS NULL
          AND member_row.user_id = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )
      )
    )
  )
  WITH CHECK (
    current_setting('app.current_user_id', true) IS NOT NULL
    AND current_setting('app.current_user_id', true) <> ''
    AND tenancy.organizations.owner_user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS memberships_user_self_discovery ON tenancy.memberships;
CREATE POLICY memberships_user_self_discovery ON tenancy.memberships
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_setting('app.current_user_id', true) IS NOT NULL
    AND current_setting('app.current_user_id', true) <> ''
    AND tenancy.memberships.user_id = (
      SELECT id FROM auth.users
      WHERE public_id = current_setting('app.current_user_id', true)
        AND deleted_at IS NULL
    )
  );

CREATE OR REPLACE FUNCTION tenancy.resolve_member_invitation_lookup_by_public_id (
  invitation_public_id_param TEXT
) RETURNS TABLE (
  organization_public_id TEXT,
  organization_id BIGINT,
  membership_public_id TEXT,
  membership_id BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenancy, public
AS $$
  SELECT
    organization_row.public_id::text AS organization_public_id,
    organization_row.id AS organization_id,
    membership_row.public_id::text AS membership_public_id,
    membership_row.id AS membership_id
  FROM tenancy.member_invitations AS invitation_row
  INNER JOIN tenancy.memberships AS membership_row ON membership_row.id = invitation_row.membership_id
  INNER JOIN tenancy.organizations AS organization_row ON organization_row.id = membership_row.organization_id
  WHERE invitation_row.public_id = invitation_public_id_param
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION tenancy.list_pending_member_invitations_for_email (
  email_param TEXT,
  limit_param INTEGER DEFAULT 100
) RETURNS TABLE (
  invitation_public_id TEXT,
  organization_public_id TEXT,
  organization_id BIGINT,
  membership_public_id TEXT,
  membership_id BIGINT,
  invitation_email TEXT,
  invitation_expires_at TIMESTAMPTZ,
  invitation_created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = tenancy, public
AS $$
  SELECT
    invitation_row.public_id::text AS invitation_public_id,
    organization_row.public_id::text AS organization_public_id,
    organization_row.id AS organization_id,
    membership_row.public_id::text AS membership_public_id,
    membership_row.id AS membership_id,
    invitation_row.email AS invitation_email,
    invitation_row.expires_at AS invitation_expires_at,
    invitation_row.created_at AS invitation_created_at
  FROM tenancy.member_invitations AS invitation_row
  INNER JOIN tenancy.memberships AS membership_row ON membership_row.id = invitation_row.membership_id
  INNER JOIN tenancy.organizations AS organization_row ON organization_row.id = membership_row.organization_id
  WHERE invitation_row.email = email_param
    AND invitation_row.accepted_at IS NULL
    AND invitation_row.revoked_at IS NULL
    AND invitation_row.expires_at > NOW()
  ORDER BY invitation_row.created_at ASC
  LIMIT limit_param;
$$;
