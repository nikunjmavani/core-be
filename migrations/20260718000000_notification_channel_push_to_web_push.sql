-- Rename the notification delivery channel PUSH -> WEB_PUSH.
-- Greenfield replacement (no backward compatibility): the product delivers browser Web Push, so the
-- generic PUSH channel value is replaced everywhere and PUSH is no longer accepted. The allowed-string
-- CHECK on tenancy.organization_notification_policies.channel and auth.user_notification_preferences.channel
-- (no native enum; an allowed string) is swapped, and any existing PUSH rows are migrated in place.

ALTER TABLE tenancy.organization_notification_policies DROP CONSTRAINT IF EXISTS chk_org_notif_channel;
--> statement-breakpoint

UPDATE tenancy.organization_notification_policies SET channel = 'WEB_PUSH' WHERE channel = 'PUSH';
--> statement-breakpoint

ALTER TABLE tenancy.organization_notification_policies ADD CONSTRAINT chk_org_notif_channel CHECK (
  channel IN ('EMAIL', 'SMS', 'WEB_PUSH', 'IN_APP')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE tenancy.organization_notification_policies VALIDATE CONSTRAINT chk_org_notif_channel;
--> statement-breakpoint

ALTER TABLE auth.user_notification_preferences DROP CONSTRAINT IF EXISTS chk_user_notif_prefs_channel;
--> statement-breakpoint

UPDATE auth.user_notification_preferences SET channel = 'WEB_PUSH' WHERE channel = 'PUSH';
--> statement-breakpoint

ALTER TABLE auth.user_notification_preferences ADD CONSTRAINT chk_user_notif_prefs_channel CHECK (
  channel IN ('EMAIL', 'SMS', 'WEB_PUSH', 'IN_APP')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE auth.user_notification_preferences VALIDATE CONSTRAINT chk_user_notif_prefs_channel;
