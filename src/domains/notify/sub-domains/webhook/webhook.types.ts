/**
 * Repository-side insert payload for {@link WebhookRepository.create} — the secret is already
 * encrypted by the service layer, never plaintext.
 */
export interface WebhookCreateData {
  organization_id: number;
  url: string;
  encrypted_secret: string;
  events: unknown;
  is_enabled?: boolean;
  created_by_user_id?: number;
}

/**
 * Repository-side patch payload for {@link WebhookRepository.update} — every field is optional
 * so callers may rotate the secret, replace events, or toggle enablement independently.
 */
export interface WebhookUpdateData {
  url?: string;
  encrypted_secret?: string;
  events?: unknown;
  is_enabled?: boolean;
}
