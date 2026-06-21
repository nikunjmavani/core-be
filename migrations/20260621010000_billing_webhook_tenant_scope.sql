-- audit #2 + #41: harden Stripe webhook tenant scoping so attacker-influencable
-- `metadata.organization_id` can never route a billing side effect into another
-- tenant, and the subscriptions RLS policy enforces tenant ownership on writes.
--
-- #2: add a SECURITY DEFINER resolver that maps a Stripe *customer* id to its
-- owning organization via the locally-persisted subscription row. This is the
-- authoritative fallback for a `customer.subscription.created` event whose
-- provider subscription id is not yet mapped locally (the row already carries
-- `provider_customer_id` from creation). With both the subscription-id and
-- customer-id resolvers, the webhook handler treats Stripe metadata as a
-- cross-check only and fails closed when neither maps — see
-- `stripe-webhook-organization.util.ts`. Each org owns a distinct Stripe
-- customer, so the mapping is unambiguous; LIMIT 1 tolerates an org holding
-- several subscription rows (canceled + re-subscribed) for the same customer.
--
-- #41: the subscriptions_tenant_isolation policy had no explicit WITH CHECK, so
-- Postgres reused the USING predicate (which carries the
-- `app.global_retention_cleanup` bypass) for write-side checks. That let any
-- context with the retention GUC set INSERT/UPDATE a subscription row under an
-- arbitrary organization_id. The explicit WITH CHECK below pins every write to
-- the active-org GUC and drops the retention bypass on the write side; the
-- USING arm keeps the bypass so the retention worker can still SELECT/DELETE.

CREATE OR REPLACE FUNCTION billing.resolve_organization_public_id_for_stripe_customer (
  provider_customer_id_param TEXT
) RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = billing, tenancy, public
AS $$
  SELECT o.public_id
  FROM billing.subscriptions AS s
  INNER JOIN tenancy.organizations AS o ON o.id = s.organization_id
  WHERE s.provider_customer_id = provider_customer_id_param
  LIMIT 1;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.resolve_organization_public_id_for_stripe_customer (TEXT) TO core_be_app;
--> statement-breakpoint
DROP POLICY IF EXISTS subscriptions_tenant_isolation ON billing.subscriptions;
--> statement-breakpoint
CREATE POLICY subscriptions_tenant_isolation ON billing.subscriptions
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
  )
  WITH CHECK (
    organization_id = (
      SELECT id
      FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
