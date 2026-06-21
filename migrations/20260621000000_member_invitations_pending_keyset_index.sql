-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- audit #18: the cross-org pending-invitation lookup
-- (tenancy.list_pending_member_invitations_for_email) filters
--   email = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
-- and keyset-orders by (created_at, id). The existing idx_member_invitations_email
-- index covers only (email, accepted_at), so the sort columns were uncovered and
-- Postgres did a per-page in-memory sort of every pending invitation for the email —
-- the exact case the keyset pagination (migration 20260614120000) was added to bound.
--
-- This partial composite index covers the predicate AND the keyset order, so each page
-- is an index range scan. Partial on (accepted_at IS NULL AND revoked_at IS NULL) keeps
-- it small (only live invitations) and aligned with the function's WHERE clause.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_member_invitations_email_pending
  ON tenancy.member_invitations (email, created_at, id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
