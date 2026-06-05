-- sec-U3: make `audit.logs` append-only at the DB layer.
--
-- The previous `audit_logs_tenant_isolation` policy was `FOR ALL`, so the
-- USING predicate doubled as the WITH CHECK / write predicate. Any caller
-- with `app.current_organization_id` set could UPDATE or DELETE audit rows
-- for their own organization through `core_be_app` — the standard runtime
-- role. Append-only was convention only, not a database-layer invariant.
--
-- Three changes harden this:
--   1. Split the `FOR ALL` policy into FOR SELECT + FOR INSERT + FOR DELETE.
--      The SELECT and INSERT predicates are byte-identical to the old
--      USING (no read/write behavior change). The DELETE predicate is
--      narrowed to retention-cleanup only: `app.global_retention_cleanup`.
--      Admin (`app.global_admin`) is intentionally NOT on DELETE — admin is
--      a read escape hatch, never a delete one.
--   2. With no `FOR UPDATE` policy, RLS structurally denies UPDATE.
--   3. `REVOKE UPDATE ON audit.logs FROM core_be_app` — belt-and-suspenders
--      so the grant layer surfaces tampering as `permission denied` before
--      RLS even runs. DELETE is left granted because the retention worker
--      runs as `core_be_app` with the retention GUC set; the new DELETE
--      policy enforces "retention-only" precisely.
--
-- The unrelated `audit_logs_user_export_select` policy (GDPR export read
-- path) is intentionally untouched.

DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit.logs;
--> statement-breakpoint
DROP POLICY IF EXISTS audit_logs_tenant_isolation_select ON audit.logs;
--> statement-breakpoint
DROP POLICY IF EXISTS audit_logs_tenant_isolation_insert ON audit.logs;
--> statement-breakpoint
DROP POLICY IF EXISTS audit_logs_tenant_isolation_delete ON audit.logs;
--> statement-breakpoint
CREATE POLICY audit_logs_tenant_isolation_select ON audit.logs
  AS PERMISSIVE
  FOR SELECT
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
    OR current_setting('app.global_retention_cleanup', true) = 'true'
    OR current_setting('app.global_admin', true) = 'true'
  );
--> statement-breakpoint
CREATE POLICY audit_logs_tenant_isolation_delete ON audit.logs
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (
    current_setting('app.global_retention_cleanup', true) = 'true'
  );
--> statement-breakpoint
REVOKE UPDATE ON audit.logs FROM core_be_app;
