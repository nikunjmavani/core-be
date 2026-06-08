-- sec-r4-T1: add deleted_at IS NULL guard to organizations_user_discovery RLS.
-- sec-r4-T2: add invitation/membership/org state filters to
--            resolve_member_invitation_lookup_by_public_id.
--
-- T1: The organizations_user_discovery policy (introduced in migration
-- 20260520000004) allows any user with an active membership to discover the
-- organization. It did not check tenancy.organizations.deleted_at IS NULL, so
-- a soft-deleted organization remained discoverable to its former members.
-- Fix: add AND tenancy.organizations.deleted_at IS NULL to the USING predicate.
-- The WITH CHECK predicate already restricts INSERTs to the owner; deleted
-- organizations cannot have new owners so no change is needed there.
--
-- T2: resolve_member_invitation_lookup_by_public_id (same migration) returned
-- a row for any invitation matched by public_id, including accepted, revoked,
-- or orphaned invitations whose membership or organization was soft-deleted.
-- Contrast with list_pending_member_invitations_for_email which already guards
-- all four conditions. Fix: add the same four guards.

-- T1: recreate the organizations_user_discovery policy with the deleted_at guard.
DROP POLICY IF EXISTS organizations_user_discovery ON tenancy.organizations;
--> statement-breakpoint
CREATE POLICY organizations_user_discovery ON tenancy.organizations
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    tenancy.organizations.deleted_at IS NULL
    AND current_setting('app.current_user_id', true) IS NOT NULL
    AND current_setting('app.current_user_id', true) <> ''
    AND (
      tenancy.organizations.owner_user_id = (
        SELECT id FROM auth.users
        WHERE public_id = current_setting('app.current_user_id', true)
          AND deleted_at IS NULL
      )
    OR tenancy.user_has_active_membership_for_organization(
      tenancy.organizations.id,
      current_setting('app.current_user_id', true)
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
--> statement-breakpoint

-- T2: recreate the lookup function with four soft-delete and state guards.
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
    AND invitation_row.accepted_at IS NULL
    AND invitation_row.revoked_at IS NULL
    AND membership_row.deleted_at IS NULL
    AND organization_row.deleted_at IS NULL
  LIMIT 1;
$$;
