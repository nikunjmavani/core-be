-- audit.outbox — add the missing FORCE ROW LEVEL SECURITY.
--
-- `audit.outbox` (the request-time staging table for the audit ledger) was created in
-- 20260609030000_audit_outbox.sql with ENABLE ROW LEVEL SECURITY + the org-scoped INSERT policy and
-- the drain SELECT/UPDATE/DELETE policies, but the matching FORCE was omitted. It was therefore the
-- only ENABLE'd tenant table without FORCE, and the only such table missing from
-- EXPECTED_FORCE_RLS_TABLES — so the diffForceRlsTables drift guard could not catch the gap (both
-- the live DB and the registry omitted it, so they agreed).
--
-- This brings audit.outbox in line with the tenant-isolation invariant ("every tenant-owned table is
-- ENABLE + FORCE RLS") and with its sibling audit tables (audit.logs and audit.dead_letter_jobs are
-- both FORCE'd). The runtime role core_be_app is a non-owner NOBYPASSRLS role, so ENABLE alone
-- already enforced the policies against it (proven by
-- src/tests/security/rls/audit-outbox-insert-rls.security.test.ts) — this is the residual
-- defense-in-depth fix: FORCE makes the policies apply to the table OWNER too, so isolation holds
-- regardless of which role owns the table, and the registry/drift guard now covers audit.outbox.
--
-- Metadata-only DDL (brief ACCESS EXCLUSIVE lock on an existing table); both statements are
-- idempotent (ENABLE is already set; repeated FORCE is a no-op).

ALTER TABLE audit.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.outbox FORCE ROW LEVEL SECURITY;
