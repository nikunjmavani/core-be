export const SUPPORTED_OAUTH_PROVIDERS = ['google', 'github'] as const;

export type OAuthProvider = (typeof SUPPORTED_OAUTH_PROVIDERS)[number];

export interface OAuthProfile {
  email: string;
  name?: string;
  avatar_url?: string;
  provider_user_id: string;
}
