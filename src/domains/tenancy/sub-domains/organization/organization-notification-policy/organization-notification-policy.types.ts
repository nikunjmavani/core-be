/** Internal Drizzle row for `tenancy.organization_notification_policies` (includes soft-delete). */
export interface OrganizationNotificationPolicyRow {
  id: number;
  public_id: string;
  organization_id: number;
  notification_type: string;
  channel: string;
  default_enabled: boolean;
  is_mandatory: boolean;
  muted_until: Date | null;
  deleted_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Public notification-policy shape returned by the API — produced by
 * {@link serializeOrganizationNotificationPolicy}.
 *
 * @remarks
 * sec-T5: `id` is the 21-char base62 `public_id` (string), NOT the internal
 * `bigserial` row id. The bigserial value was previously exposed and broke
 * the codebase-wide `public_id`-in-URLs convention; the schema's
 * `idx_organization_notification_policies_public_id` unique index makes
 * lookup by public id O(1).
 */
export interface OrganizationNotificationPolicyOutput {
  id: string;
  organization_id: string;
  notification_type: string;
  channel: string;
  default_enabled: boolean;
  is_mandatory: boolean;
  muted_until: string | null;
  created_at: string;
  updated_at: string;
}
