-- Migration: auth_users_add_onboarding_completed_at
-- Created: 2026-07-10T12:57:46.137Z
-- Reference: docs/reference/data/migrations.md
--
-- Statements run inside a single transaction. Use `--> statement-breakpoint`
-- between statements only when the postgres simple-query protocol needs each
-- statement sent independently (DO blocks, dollar quoting, dependent DDL).
--
-- Non-transactional lane (CREATE INDEX CONCURRENTLY): add
-- `-- migration-transaction: none reason="..."` in the first 20 lines to run
-- statements outside a transaction. Separate every statement with
-- `--> statement-breakpoint` (each runs independently — CONCURRENTLY cannot
-- share an implicit transaction) and keep them idempotent (IF NOT EXISTS);
-- there is no rollback if one fails mid-file.
--
-- Migration-safety lints (`pnpm db:migrate:lint`):
--   - CREATE TABLE / INDEX / SCHEMA must use IF NOT EXISTS.
--   - Use `ADD COLUMN ... NULL` + backfill + `SET NOT NULL` (never NOT NULL inline).
--   - Use `ADD CONSTRAINT ... NOT VALID` for FK / CHECK, then `VALIDATE` later.
--   - Use `CREATE INDEX CONCURRENTLY` in a `migration-transaction: none` migration.
--
-- Override a rule with: `-- migration-safety: allow <rule_id> reason="..."` in
-- the first 20 lines.

-- Adds `onboarding_completed_at` to auth.users so onboarding is driven by an
-- explicit per-user signal instead of "does the caller have a workspace yet".
-- That makes the wizard consistent across deployment modes: every fresh user
-- (personal OR team) is routed through onboarding once — only the steps differ.
-- Nullable, no default: NULL = not yet onboarded.
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
--> statement-breakpoint
-- Backfill the existing base as already-onboarded (stamped at account creation)
-- so a deployed population is never re-sent through the wizard on next sign-in.
-- Only users created AFTER this migration keep the NULL default and onboard once.
UPDATE auth.users
  SET onboarding_completed_at = created_at
  WHERE onboarding_completed_at IS NULL;

