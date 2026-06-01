-- Admin audit-log listing (GLOBAL_ROLES SUPER_ADMIN/ADMIN) reads across tenants.
-- The tenant-isolation policy previously only allowed organization-scoped or
-- retention-cleanup reads, so the admin listing silently depended on the
-- table-owner RLS bypass and returned nothing under FORCE RLS / least-privilege
-- roles. Add the app.global_admin escape hatch (already used by auth.users and
-- auth.auth_methods) so the admin listing runs under an explicit, RLS-correct
-- cross-tenant context via withGlobalAdminDatabaseContext.

DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit.logs;

CREATE POLICY audit_logs_tenant_isolation ON audit.logs
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    organization_id = (
      SELECT id
      FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
    OR current_setting('app.global_retention_cleanup', true) = 'true'
    OR current_setting('app.global_admin', true) = 'true'
  );
