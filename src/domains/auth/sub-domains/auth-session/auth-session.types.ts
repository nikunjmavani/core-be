/** Insert payload accepted by {@link AuthSessionRepository.create}; `public_id` is generated server-side, so only the user link, token hash, network metadata, and expiry are required. */
export interface AuthSessionCreateData {
  user_id: number;
  token_hash: string;
  ip_address: string;
  user_agent?: string;
  expires_at: Date;
}
