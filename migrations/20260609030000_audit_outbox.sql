-- migration-safety: allow create_index_without_concurrently reason="New empty audit.outbox table created in this migration; no live writes to block."
-- P0-#2 audit outbox: transactional outbox for audit.logs writes. Audit rows are staged
-- in audit.outbox inside the caller's business transaction (so the audit commits atomically
-- with the write it audits) and a background worker drains them to audit.logs out-of-band.
-- Removes the per-row transaction + actor-resolution latency that bulk operations were
-- paying inside the request handler.

CREATE TABLE IF NOT EXISTS audit.outbox (
  id BIGSERIAL PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  actor_user_public_id VARCHAR(28),
  actor_api_key_public_id VARCHAR(28),
  target_user_public_id VARCHAR(28),
  organization_public_id VARCHAR(28),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id BIGINT,
  ip_address VARCHAR(45),
  user_agent TEXT,
  severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT chk_audit_outbox_status CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED')),
  CONSTRAINT chk_audit_outbox_severity CHECK (severity IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')),
  -- Audit rows must be attributable. The drain worker re-checks this so a broken caller
  -- surfaces as FAILED rather than silently writing a bogus row into audit.logs.
  CONSTRAINT chk_audit_outbox_actor_present CHECK (
    actor_user_public_id IS NOT NULL OR actor_api_key_public_id IS NOT NULL
  ),
  CONSTRAINT chk_audit_outbox_attempt_count_nonneg CHECK (attempt_count >= 0)
);
--> statement-breakpoint

-- Drain claim path: WHERE status = 'PENDING' ORDER BY created_at, LIMIT N FOR UPDATE SKIP LOCKED.
CREATE INDEX IF NOT EXISTS idx_audit_outbox_status_created_at
  ON audit.outbox (status, created_at);
--> statement-breakpoint

-- Per-org operator triage: list FAILED rows for a single tenant.
CREATE INDEX IF NOT EXISTS idx_audit_outbox_org_status
  ON audit.outbox (organization_public_id, status);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON audit.outbox TO core_be_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE audit.outbox_id_seq TO core_be_app;
--> statement-breakpoint

ALTER TABLE audit.outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- INSERT — tenant context writes its own org row, OR system-audit context writes a
-- tenantless (organization_public_id IS NULL) row. Mirrors audit.logs INSERT policy.
DROP POLICY IF EXISTS audit_outbox_tenant_isolation_insert ON audit.outbox;
--> statement-breakpoint
CREATE POLICY audit_outbox_tenant_isolation_insert ON audit.outbox
  AS PERMISSIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    organization_public_id = current_setting('app.current_organization_id', true)
    OR (
      organization_public_id IS NULL
      AND current_setting('app.system_audit_insert', true) = 'true'
    )
  );
--> statement-breakpoint

-- SELECT/UPDATE/DELETE gated to the drain-worker context. Prevents any tenant from
-- reading another tenant's pending audit and prevents accidental request-context UPDATE/DELETE.
DROP POLICY IF EXISTS audit_outbox_drain_select ON audit.outbox;
--> statement-breakpoint
CREATE POLICY audit_outbox_drain_select ON audit.outbox
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (current_setting('app.audit_outbox_drain', true) = 'true');
--> statement-breakpoint

DROP POLICY IF EXISTS audit_outbox_drain_update ON audit.outbox;
--> statement-breakpoint
CREATE POLICY audit_outbox_drain_update ON audit.outbox
  AS PERMISSIVE
  FOR UPDATE
  TO PUBLIC
  USING (current_setting('app.audit_outbox_drain', true) = 'true')
  WITH CHECK (current_setting('app.audit_outbox_drain', true) = 'true');
--> statement-breakpoint

DROP POLICY IF EXISTS audit_outbox_drain_delete ON audit.outbox;
--> statement-breakpoint
CREATE POLICY audit_outbox_drain_delete ON audit.outbox
  AS PERMISSIVE
  FOR DELETE
  TO PUBLIC
  USING (current_setting('app.audit_outbox_drain', true) = 'true');
