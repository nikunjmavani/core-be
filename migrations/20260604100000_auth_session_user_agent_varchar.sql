-- Constrain user_agent to 512 characters to prevent row-bloat attacks via oversized
-- User-Agent headers. The application now truncates at 512 before persist; this
-- constraint enforces the same limit at the database level.
--
-- migration-safety: allow alter_column_type reason="text → varchar(512) with USING left(..., 512); app-layer truncation already in place so no data loss; rewrite is safe on the auth.sessions table which has no long-running transactions"

ALTER TABLE auth.sessions
  ALTER COLUMN user_agent TYPE varchar(512) USING left(user_agent, 512);
