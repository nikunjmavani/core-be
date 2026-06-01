-- Migration: auth_session_refresh_token_hash_index
-- Created: 2026-05-30T15:09:50.545Z
-- Reference: docs/reference/data/migrations.md
-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run inside a transaction; auth.sessions is high-write"
--
-- Index the rotating refresh credential. Refresh-token rotation filters
-- auth.sessions by refresh_token_hash, and the sessions RLS policy compares it
-- against app.current_session_refresh_token_hash; without an index those paths
-- fall back to a sequential scan as the table grows. Partial — sessions that
-- never refreshed (NULL refresh_token_hash) are excluded to keep the index small.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_refresh_token_hash
  ON auth.sessions (refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;
