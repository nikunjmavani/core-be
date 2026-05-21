export interface WebhookCreateData {
  organization_id: number;
  url: string;
  encrypted_secret: string;
  events: unknown;
  is_enabled?: boolean;
  created_by_user_id?: number;
}

export interface WebhookUpdateData {
  url?: string;
  encrypted_secret?: string;
  events?: unknown;
  is_enabled?: boolean;
}
