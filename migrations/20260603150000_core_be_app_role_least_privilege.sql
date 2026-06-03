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
-- Pin the posture explicitly so the intent is encoded in the schema, not inherited from defaults.
-- These are already the effective defaults for a freshly-created role, so this is a no-op in
-- behavior today; its value is making any future drift a visible, reviewable change. ALTER ROLE is
-- idempotent and safe to re-run.

ALTER ROLE core_be_app
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;
