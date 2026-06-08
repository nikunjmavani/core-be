-- sec-r4-D1: remove global_admin and global_retention_cleanup escape hatches
-- from the audit.logs INSERT (WITH CHECK) predicate.
--
-- When migration 20260605220000 split the old FOR ALL policy into SELECT +
-- INSERT + DELETE, it copied the escape hatches from the SELECT policy into
-- the INSERT WITH CHECK unchanged. That was a copy/paste error: neither the
-- global cleanup context (runs retention DELETEs) nor the admin context (read
-- escape hatch — explicitly documented as non-DELETE in the DELETE policy) has
-- any legitimate reason to INSERT audit rows outside a normal tenant context.
-- Keeping them in WITH CHECK allows any process with either GUC set to write
-- audit rows for arbitrary organizations, bypassing the tenant isolation
-- invariant on writes.
--
-- The SELECT policy retains both escape hatches (audit reads during admin
-- views and retention sweeps are valid). Only INSERT is tightened.
--
-- No data migration needed: no existing rows were inserted via these paths
-- in production; normal tenant inserts continue to pass.

DROP POLICY IF EXISTS audit_logs_tenant_isolation_insert ON audit.logs;
--> statement-breakpoint
CREATE POLICY audit_logs_tenant_isolation_insert ON audit.logs
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    organization_id = (
      SELECT id
      FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
