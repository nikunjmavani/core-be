import type {
  OrganizationNotificationPolicyRow,
  OrganizationNotificationPolicyOutput,
} from './organization-notification-policy.types.js';

export function serializeOrganizationNotificationPolicy(
  row: OrganizationNotificationPolicyRow,
  organization_public_id: string,
): OrganizationNotificationPolicyOutput {
  return {
    id: row.id,
    organization_id: organization_public_id,
    notification_type: row.notification_type,
    channel: row.channel,
    default_enabled: row.default_enabled,
    is_mandatory: row.is_mandatory,
    muted_until: row.muted_until?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
