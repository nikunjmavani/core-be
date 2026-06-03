-- Make the application role's least-privilege posture EXPLICIT.
--
-- `core_be_app` is the non-superuser role the application runs as in production, and the role the
-- non-superuser RLS test lane assumes when it does `SET LOCAL ROLE core_be_app`. It was created in
-- the baseline as `CREATE ROLE core_be_app NOLOGIN;`, relying on Postgres defaults (NOSUPERUSER,
-- NOBYPASSRLS) being correct.
--
-- The risk: if a future migration or a manual change ever granted BYPASSRLS or SUPERUSER to this
-- role, every FORCE ROW LEVEL SECURITY policy would silently stop applying to it. Production would
-- be exposed AND the non-superuser RLS tests — which only mean anything if the role is genuinely
-- RLS-bound — would quietly become no-ops that still pass. The org-mandated-MFA bypass was exactly
-- this class of failure: a FORCE-RLS table resolved to zero rows under this role and the code read
-- "zero rows" as "no MFA required".
--
-- Pin the posture explicitly so future drift is a visible, reviewable change. These are already the
-- effective defaults for a NOLOGIN role, so this is a behavioral no-op today.
--
-- Neon-safety: Postgres requires the SUPERUSER attribute to ALTER another role's
-- SUPERUSER/BYPASSRLS/REPLICATION attributes -- even when setting them to the values they already
-- have. On managed Postgres (Neon, RDS) the migration role is NOT a superuser, so a bare
-- `ALTER ROLE ... NOSUPERUSER` fails with SQLSTATE 42501 and blocks the deploy. Wrap it so it pins
-- the attributes where the executing role is permitted (self-hosted / superuser) and is a safe
-- no-op elsewhere -- the NOLOGIN defaults already hold, and the role-privileges security test
-- verifies the end state regardless of which path ran.
DO $$
BEGIN
  ALTER ROLE core_be_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'core_be_app least-privilege ALTER skipped (migration role lacks SUPERUSER); the NOLOGIN defaults already apply';
END $$;
