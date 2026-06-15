-- reaudit-#9: billing.plans and tenancy.permissions are global read-only catalogs that were the
-- only two app tables left without RLS — missed by 20260520000001_system_tables_rls_deny_all.
-- Apply the same defense-in-depth pattern: FORCE RLS with a deny-all policy for PUBLIC plus a
-- full-access policy for the runtime role (core_be_app). Reads/writes by the application and the
-- seeders (which run as core_be_app or a superuser that bypasses RLS) are unaffected; any other
-- role / context-less connection is denied, so a compromised non-app credential cannot read or
-- tamper with the plan/permission catalog.

ALTER TABLE billing.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_deny_all ON billing.plans;
CREATE POLICY plans_deny_all ON billing.plans
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS plans_app_access ON billing.plans;
CREATE POLICY plans_app_access ON billing.plans
  AS PERMISSIVE
  FOR ALL
  TO core_be_app
  USING (true)
  WITH CHECK (true);

ALTER TABLE tenancy.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenancy.permissions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS permissions_deny_all ON tenancy.permissions;
CREATE POLICY permissions_deny_all ON tenancy.permissions
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS permissions_app_access ON tenancy.permissions;
CREATE POLICY permissions_app_access ON tenancy.permissions
  AS PERMISSIVE
  FOR ALL
  TO core_be_app
  USING (true)
  WITH CHECK (true);
