/** Lower-cased OAuth provider slugs the platform supports today (used by both the redirect builder and the callback handler). */
export const SUPPORTED_OAUTH_PROVIDERS = ['google', 'github'] as const;

/** Literal union of supported provider slugs in {@link SUPPORTED_OAUTH_PROVIDERS}. */
export type OAuthProvider = (typeof SUPPORTED_OAUTH_PROVIDERS)[number];

/** Normalised user profile returned by `exchangeXOAuthCode` helpers, consumed by {@link completeOAuthUserSession}. */
export interface OAuthProfile {
  email: string;
  name?: string;
  avatar_url?: string;
  provider_user_id: string;
}
