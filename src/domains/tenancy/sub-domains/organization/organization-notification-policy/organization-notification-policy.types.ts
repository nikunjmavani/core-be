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

/** Public notification-policy shape returned by the API — produced by {@link serializeOrganizationNotificationPolicy}. */
export interface OrganizationNotificationPolicyOutput {
  id: number;
  organization_id: string;
  notification_type: string;
  channel: string;
  default_enabled: boolean;
  is_mandatory: boolean;
  muted_until: string | null;
  created_at: string;
  updated_at: string;
}
