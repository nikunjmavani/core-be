export interface AuthLoginResult {
  access_token: string;
}

export interface MagicLinkSendResult {
  message: string;
  expires_in_minutes: number;
  token?: string;
}
