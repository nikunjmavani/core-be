export interface AuthSessionCreateData {
  user_id: number;
  token_hash: string;
  ip_address: string;
  user_agent?: string;
  expires_at: Date;
}
