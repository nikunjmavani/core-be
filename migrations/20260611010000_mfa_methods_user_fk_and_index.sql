-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
-- reaudit-#1: auth.mfa_methods stores encrypted MFA secrets keyed on user_id, but the
-- column had NO foreign key to auth.users and NO index. The user-tombstone retention
-- worker hard-deletes the user row and relies on FK ON DELETE CASCADE to purge per-user
-- children; with no FK, every hard-deleted user who had an MFA method left an ORPHANED
-- row carrying its encrypted secret — a GDPR / data-retention hole — and the per-user
-- RLS/owner lookups did a sequential scan.
--
-- Fix:
--   1. Index user_id (the RLS owner predicate + every per-user read filters on it).
--   2. Purge existing orphans (rows whose user no longer exists) — these belong to
--      already-deleted users and MUST be removed (the GDPR remediation). Bounded:
--      only rows with no matching live user are touched.
--   3. NULL out dangling created_by_user_id so its FK can be added.
--   4. Add the FKs: user_id ON DELETE CASCADE (future deletes purge the secret),
--      created_by_user_id ON DELETE SET NULL. NOT VALID per the migration-safety rule
--      (no full-table scan; referential actions incl. CASCADE are still enforced for all
--      subsequent DML — which is what closes the leak going forward).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mfa_methods_user_id
  ON auth.mfa_methods (user_id);
--> statement-breakpoint

DELETE FROM auth.mfa_methods
WHERE user_id NOT IN (SELECT id FROM auth.users);
--> statement-breakpoint

UPDATE auth.mfa_methods
SET created_by_user_id = NULL
WHERE created_by_user_id IS NOT NULL
  AND created_by_user_id NOT IN (SELECT id FROM auth.users);
--> statement-breakpoint

ALTER TABLE auth.mfa_methods
  ADD CONSTRAINT mfa_methods_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
--> statement-breakpoint

ALTER TABLE auth.mfa_methods
  ADD CONSTRAINT mfa_methods_created_by_user_id_users_id_fk
  FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
