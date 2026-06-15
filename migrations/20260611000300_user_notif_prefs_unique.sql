-- migration-transaction: none reason="CREATE/DROP INDEX CONCURRENTLY cannot run in a transaction"
-- audit-#11: auth.user_notification_preferences had only a NON-unique index on
-- (user_id, notification_type, channel). A payload carrying duplicate
-- (type, channel) tuples — or any future write path other than the replace-all
-- cascade — could persist two conflicting rows for the same tuple, making a
-- .limit(1) preference read nondeterministic (a user who opted OUT of email could
-- still be emailed). Add the UNIQUE so the natural key is enforced at the data
-- layer. The replaceAll repository path is updated in the same change to dedupe its
-- input so the happy path cannot trip the new constraint.
--
-- PREREQUISITE: no existing duplicate (user_id, notification_type, channel) rows. If
-- one exists, the CONCURRENTLY build leaves an INVALID index and the runner fails
-- loudly — dedupe, then re-run. No data is mutated. Idempotent via IF [NOT] EXISTS.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_user_notif_prefs_user_type_channel_unique
  ON auth.user_notification_preferences (user_id, notification_type, channel);
--> statement-breakpoint

DROP INDEX CONCURRENTLY IF EXISTS auth.idx_user_notif_prefs_user_type;
