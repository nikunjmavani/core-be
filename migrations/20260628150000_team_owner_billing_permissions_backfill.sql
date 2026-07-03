-- Backfill subscription:read + subscription:manage on existing TEAM org Owner roles.
-- New TEAM orgs receive these via organization-provisioning.ts; this closes the gap
-- for orgs created before that bootstrap change.

INSERT INTO tenancy.role_permissions (role_id, permission_code, created_by_user_id)
SELECT
  r.id,
  billing.code,
  COALESCE(r.created_by_user_id, o.owner_user_id)
FROM tenancy.roles r
INNER JOIN tenancy.organizations o ON o.id = r.organization_id
CROSS JOIN (
  VALUES
    ('subscription:read'),
    ('subscription:manage')
) AS billing (code)
WHERE r.is_system = true
  AND r.name = 'Owner'
  AND o.type = 'TEAM'
  AND o.deleted_at IS NULL
ON CONFLICT (role_id, permission_code) DO NOTHING;
