export interface NotificationPreferenceOutput {
  id: number;
  notification_type: string;
  channel: string;
  organization_id: number | null;
  is_enabled: boolean;
}
