-- R5 / TEN-35: add keyset (cursor) pagination to the cross-organization
-- "list my pending invitations" SECURITY DEFINER function.
--
-- Background:
--   GET /api/v1/tenancy/invitations/pending called
--   tenancy.list_pending_member_invitations_for_email(email, 100) and returned a
--   plain array silently capped at 100. A user invited to more than 100
--   organizations could never discover or act on the older invitations through
--   the API. This recreates the function with (created_at, id) keyset params and
--   exposes the invitation's internal id so the repository can mint an opaque
--   next-cursor. Soft-delete guards for the membership and organization are added
--   for parity with resolve_member_invitation_lookup_by_public_id (T2).
--
-- Safety: CREATE OR REPLACE FUNCTION changes the return signature (adds the
-- leading invitation_id column), so the prior overload is dropped first to avoid
-- a "cannot change return type of existing function" error.

DROP FUNCTION IF EXISTS tenancy.list_pending_member_invitations_for_email (TEXT, INTEGER);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenancy.list_pending_member_invitations_for_email (
  email_param TEXT,
  limit_param INTEGER DEFAULT 100,
  after_created_at_param TIMESTAMPTZ DEFAULT NULL,
  after_id_param BIGINT DEFAULT NULL
) RETURNS TABLE (
  invitation_id BIGINT,
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
    invitation_row.id AS invitation_id,
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
    AND membership_row.deleted_at IS NULL
    AND organization_row.deleted_at IS NULL
    AND (
      after_created_at_param IS NULL
      OR invitation_row.created_at > after_created_at_param
      OR (
        invitation_row.created_at = after_created_at_param
        AND invitation_row.id > after_id_param
      )
    )
  ORDER BY invitation_row.created_at ASC, invitation_row.id ASC
  LIMIT limit_param;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION tenancy.list_pending_member_invitations_for_email (TEXT, INTEGER, TIMESTAMPTZ, BIGINT) TO core_be_app;
