-- migration-safety: allow create_index_without_concurrently reason="New empty audit.dead_letter_jobs table created in this migration; no live writes to block."
-- Durable dead-letter ledger (audit #15): persist final job failures to Postgres as the
-- source of truth operators replay from. The <source>-dlq Redis queue stays a best-effort
-- mirror. Defense-in-depth RLS (deny-all + core_be_app) matches other system tables.

CREATE TABLE IF NOT EXISTS audit.dead_letter_jobs (
  id BIGSERIAL NOT NULL,
  source_queue TEXT NOT NULL,
  dead_letter_queue TEXT NOT NULL,
  job_id TEXT,
  job_name TEXT NOT NULL,
  payload_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  failed_reason TEXT NOT NULL,
  error_stack TEXT,
  attempts_made INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_dead_letter_jobs PRIMARY KEY (id),
  CONSTRAINT chk_dead_letter_jobs_attempts_made_positive CHECK (attempts_made >= 0),
  CONSTRAINT chk_dead_letter_jobs_max_attempts_positive CHECK (max_attempts >= 1)
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_source_queue_failed_at
  ON audit.dead_letter_jobs (source_queue, failed_at);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_failed_at
  ON audit.dead_letter_jobs (failed_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON audit.dead_letter_jobs TO core_be_app;
GRANT USAGE, SELECT ON SEQUENCE audit.dead_letter_jobs_id_seq TO core_be_app;

-- Defense in depth: non-tenant system table gets deny-all + role-scoped access (see
-- migrations/20260520000001_system_tables_rls_deny_all.sql for the same pattern).
ALTER TABLE audit.dead_letter_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.dead_letter_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dead_letter_jobs_deny_all ON audit.dead_letter_jobs;
CREATE POLICY dead_letter_jobs_deny_all ON audit.dead_letter_jobs
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS dead_letter_jobs_app_access ON audit.dead_letter_jobs;
CREATE POLICY dead_letter_jobs_app_access ON audit.dead_letter_jobs
  AS PERMISSIVE
  FOR ALL
  TO core_be_app
  USING (true)
  WITH CHECK (true);
