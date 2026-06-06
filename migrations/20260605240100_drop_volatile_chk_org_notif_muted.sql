-- sec-D1: drop the volatile CHECK `muted_until IS NULL OR muted_until > now()`.
--
-- Postgres re-evaluates this CHECK on EVERY UPDATE of the row, even when
-- `muted_until` is not in the SET list. Once a stored `muted_until` slips
-- into the past, every subsequent write — including the offboarding
-- soft-delete — fails because the pre-existing value no longer satisfies
-- the constraint. The row becomes immutable until manual SQL intervention.
--
-- Mute expiry is a read-side concern; readers already filter
-- `muted_until > now()`. Writers in the repository normalize stale mutes
-- to NULL before persisting (see organization-notification-policy.repository.ts
-- comment). With both in place, the database CHECK is unnecessary AND a
-- footgun.
--
-- Idempotent: `DROP CONSTRAINT IF EXISTS` is safe to re-run.

ALTER TABLE tenancy.organization_notification_policies
  DROP CONSTRAINT IF EXISTS chk_org_notif_muted;
