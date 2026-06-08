-- sec-r5-async-queue-1: re-open the audit.logs INSERT policy for system-level
-- (tenantless) writes. After sec-r4-D1 closed the `global_admin` and
-- `global_retention_cleanup` escape arms, the audit INSERT became
-- tenant-only. That hardening was correct but unmasked a latent bug:
-- DLQ replay (auto + CLI) writes `queue.dlq.auto_retried` and
-- `queue.dlq.replayed` rows without a tenant context — they are
-- legitimately tenantless system events. With the org-only policy,
-- the INSERT throws, the throw is swallowed in
-- `dlq-auto-retry.processor.ts:124-126`, and `recordDlqAutoRetryAttempt`
-- never advances the Redis counter, so the same 20 ledger rows get
-- selected at the head forever — head-of-line starvation for the
-- entire DLQ auto-retry subsystem, plus a silent gap in the
-- tamper-evident audit trail.
--
-- The fix re-opens a NARROW arm that is NOT tenant-impersonating:
-- the arm fires only when `organization_id IS NULL` AND
-- `current_setting('app.system_audit_insert', true) = 'true'`. Because
-- `organization_id IS NULL` is a hard constraint of the arm, a process
-- that flips this GUC cannot write to any arbitrary tenant's audit log
-- — they can only write tenantless rows. The sec-r4-D1 regression
-- test still passes: global_admin context with a real `organization_id`
-- and no `current_organization_id` GUC remains rejected, because the
-- first arm fails (NULL = NULL → NULL, not TRUE) and the second arm
-- requires `organization_id IS NULL`.
--
-- The GUC is set by a single application-side helper
-- (`withSystemAuditInsertContext` in
-- `src/infrastructure/database/contexts/system-audit-insert-database.context.ts`).
-- Only DLQ replay code (and any future system-audit emitters reviewed
-- under this comment) is expected to call that helper.

DROP POLICY IF EXISTS audit_logs_tenant_isolation_insert ON audit.logs;
--> statement-breakpoint
CREATE POLICY audit_logs_tenant_isolation_insert ON audit.logs
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    -- Normal tenant path: organization_id must match the active tenant GUC.
    organization_id = (
      SELECT id
      FROM tenancy.organizations
      WHERE public_id = current_setting('app.current_organization_id', true)
    )
    OR
    -- System-level tenantless audit path (sec-r5-async-queue-1): the inserted
    -- row MUST have organization_id IS NULL — this arm cannot be used to
    -- impersonate a tenant. The GUC is set only by
    -- `withSystemAuditInsertContext`.
    (
      organization_id IS NULL
      AND current_setting('app.system_audit_insert', true) = 'true'
    )
  );
