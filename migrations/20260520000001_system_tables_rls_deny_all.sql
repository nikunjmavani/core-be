-- Defense in depth: system tables without tenant RLS get deny-all + role-scoped policies.
-- Workers and app role access only via explicit GRANT + policy (see system-tables-without-tenant-rls.md).

ALTER TABLE billing.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.stripe_webhook_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_webhook_events_deny_all ON billing.stripe_webhook_events;
CREATE POLICY stripe_webhook_events_deny_all ON billing.stripe_webhook_events
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS stripe_webhook_events_app_access ON billing.stripe_webhook_events;
CREATE POLICY stripe_webhook_events_app_access ON billing.stripe_webhook_events
  AS PERMISSIVE
  FOR ALL
  TO core_be_app
  USING (true)
  WITH CHECK (true);

ALTER TABLE auth.mail_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.mail_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mail_outbox_deny_all ON auth.mail_outbox;
CREATE POLICY mail_outbox_deny_all ON auth.mail_outbox
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS mail_outbox_app_access ON auth.mail_outbox;
CREATE POLICY mail_outbox_app_access ON auth.mail_outbox
  AS PERMISSIVE
  FOR ALL
  TO core_be_app
  USING (true)
  WITH CHECK (true);
