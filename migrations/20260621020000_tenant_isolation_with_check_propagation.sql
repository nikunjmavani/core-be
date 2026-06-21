-- audit H1: propagate the explicit RLS WITH CHECK fix (first applied to
-- billing.subscriptions in 20260621010000) to every other org-scoped
-- `_tenant_isolation` policy. Each is FOR ALL with a USING that carries
-- `OR app.global_retention_cleanup='true'`; with no explicit WITH CHECK, Postgres
-- reuses that bypass-carrying USING for INSERT/UPDATE write checks, so any context
-- running under `withGlobalRetentionCleanupDatabaseContext` could write a row
-- under an arbitrary tenant. Pin each WITH CHECK to the active-org GUC (the same
-- org/role/membership arm as USING, WITHOUT the retention bypass), keeping the
-- bypass only in USING so retention SELECT/DELETE still works. ALTER POLICY ...
-- WITH CHECK adds the write-side predicate without touching USING and without a
-- policy-gap window.
--
-- The companion `*_owner_access` policies (notifications/uploads) are user_id-match
-- only with NO retention bypass, so their implicit WITH CHECK is already safe and
-- is intentionally left untouched — a user-only row (organization_id IS NULL)
-- still writes via owner_access since the tenant_isolation arm requires
-- organization_id IS NOT NULL.
--
-- Latent today: all retention/tombstone workers are DELETE-only, so no legitimate
-- write currently runs under the retention GUC; this closes the class as
-- defense-in-depth.

ALTER POLICY webhooks_tenant_isolation ON notify.webhooks
  WITH CHECK (
    notify.webhooks.organization_id = (
      SELECT id FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
--> statement-breakpoint
ALTER POLICY webhook_delivery_attempts_tenant_isolation ON notify.webhook_delivery_attempts
  WITH CHECK (
    notify.webhook_delivery_attempts.webhook_id IN (
      SELECT id FROM notify.webhooks
      WHERE organization_id = (
        SELECT id FROM tenancy.organizations
        WHERE public_id = current_setting('app.current_organization_id', true)
      )
    )
  );
--> statement-breakpoint
ALTER POLICY notifications_tenant_isolation ON notify.notifications
  WITH CHECK (
    notify.notifications.organization_id IS NOT NULL
    AND notify.notifications.organization_id = (
      SELECT id FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
--> statement-breakpoint
ALTER POLICY memberships_tenant_isolation ON tenancy.memberships
  WITH CHECK (
    tenancy.memberships.organization_id = (
      SELECT id FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
--> statement-breakpoint
ALTER POLICY roles_tenant_isolation ON tenancy.roles
  WITH CHECK (
    tenancy.roles.organization_id = (
      SELECT id FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
--> statement-breakpoint
ALTER POLICY role_permissions_tenant_isolation ON tenancy.role_permissions
  WITH CHECK (
    tenancy.role_permissions.role_id IN (
      SELECT id FROM tenancy.roles
      WHERE organization_id = (
        SELECT id FROM tenancy.organizations
        WHERE public_id = current_setting('app.current_organization_id', true)
      )
    )
  );
--> statement-breakpoint
ALTER POLICY member_invitations_tenant_isolation ON tenancy.member_invitations
  WITH CHECK (
    tenancy.member_invitations.membership_id IN (
      SELECT id FROM tenancy.memberships
      WHERE organization_id = (
        SELECT id FROM tenancy.organizations
        WHERE public_id = current_setting('app.current_organization_id', true)
      )
    )
  );
--> statement-breakpoint
ALTER POLICY api_keys_tenant_isolation ON tenancy.api_keys
  WITH CHECK (
    tenancy.api_keys.organization_id = (
      SELECT id FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
--> statement-breakpoint
ALTER POLICY organization_notification_policies_tenant_isolation ON tenancy.organization_notification_policies
  WITH CHECK (
    tenancy.organization_notification_policies.organization_id = (
      SELECT id FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
--> statement-breakpoint
ALTER POLICY organization_settings_tenant_isolation ON tenancy.organization_settings
  WITH CHECK (
    tenancy.organization_settings.organization_id = (
      SELECT id FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
--> statement-breakpoint
ALTER POLICY organizations_tenant_isolation ON tenancy.organizations
  WITH CHECK (
    tenancy.organizations.public_id = current_setting('app.current_organization_id', true)
  );
--> statement-breakpoint
ALTER POLICY uploads_tenant_isolation ON upload.uploads
  WITH CHECK (
    upload.uploads.organization_id IS NOT NULL
    AND upload.uploads.organization_id = (
      SELECT id FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
  );
