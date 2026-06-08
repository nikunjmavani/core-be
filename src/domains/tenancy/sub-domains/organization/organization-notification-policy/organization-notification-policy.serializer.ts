import type {
  OrganizationNotificationPolicyRow,
  OrganizationNotificationPolicyOutput,
} from './organization-notification-policy.types.js';

/**
 * Maps an {@link OrganizationNotificationPolicyRow} to the public
 * {@link OrganizationNotificationPolicyOutput}, swapping the internal
 * organization id for the org's public id and serialising timestamps as
 * ISO 8601 strings.
 */
export function serializeOrganizationNotificationPolicy(
  row: OrganizationNotificationPolicyRow,
  organization_public_id: string,
): OrganizationNotificationPolicyOutput {
  return {
    // sec-T5: emit the 21-char public_id, NOT the internal bigserial. The
    // schema already provisions public_id and the unique index keeps the
    // lookup O(1).
    id: row.public_id,
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
