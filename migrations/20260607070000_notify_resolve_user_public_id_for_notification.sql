-- sec-D #10: replace the notification worker's use of `app.global_retention_cleanup`
-- (a wide retention escape hatch) with a narrow user-scoped context for routine
-- NULL-organization notification dispatch. The worker needs to resolve the
-- recipient's public id BEFORE entering `withUserDatabaseContext` (which sets
-- `app.current_user_id` for the `notifications_owner_access` policy), so we
-- mirror the existing `auth.resolve_user_public_ids_by_ids` pattern: a narrow
-- SECURITY DEFINER resolver that returns only `(notification_id → user_public_id)`
-- and exposes no other columns.
--
-- Granting EXECUTE to `core_be_app` lets the application role call the function
-- without bypassing RLS broadly; the function itself runs as the function
-- owner (postgres) and performs exactly one bounded read.

CREATE OR REPLACE FUNCTION notify.resolve_user_public_id_for_notification (
  notification_id_param BIGINT
) RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = notify, auth, public
AS $$
  SELECT user_row.public_id::text
  FROM notify.notifications AS notification_row
  INNER JOIN auth.users AS user_row ON user_row.id = notification_row.user_id
  WHERE notification_row.id = notification_id_param
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION notify.resolve_user_public_id_for_notification (BIGINT)
  TO core_be_app;
