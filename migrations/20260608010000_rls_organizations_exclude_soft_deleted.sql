-- sec-new-D3: tighten the `organizations_tenant_isolation` RLS policy so that
-- soft-deleted organizations are invisible to normal tenant requests.
--
-- Previously the USING clause allowed any row whose `public_id` matched
-- `app.current_organization_id`, including rows with a non-NULL `deleted_at`.
-- This meant a request carrying a deleted organization's public_id as
-- `X-Organization-Id` could still query the organizations table row directly
-- (other tables are protected by joining against `tenancy.organizations` with
-- an `id`-based FK, but a direct read on `tenancy.organizations` by `public_id`
-- was not filtered).
--
-- The fix adds `AND deleted_at IS NULL` to the tenant-scoped arm only.
-- The `app.global_retention_cleanup = 'true'` bypass arm is intentionally
-- unchanged — retention workers need visibility into deleted rows to tombstone /
-- hard-delete them.

DROP POLICY IF EXISTS "organizations_tenant_isolation" ON "tenancy"."organizations";--> statement-breakpoint

CREATE POLICY "organizations_tenant_isolation" ON "tenancy"."organizations"
  AS PERMISSIVE FOR ALL TO public
  USING (
    (
      "tenancy"."organizations"."public_id" = current_setting('app.current_organization_id', true)
      AND "tenancy"."organizations"."deleted_at" IS NULL
    )
    OR current_setting('app.global_retention_cleanup', true) = 'true'
  );--> statement-breakpoint
