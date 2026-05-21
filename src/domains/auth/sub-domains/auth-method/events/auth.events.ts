export const AUTH_EVENT = {
  MAGIC_LINK_REQUESTED: 'auth.magic_link.requested',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset.requested',
  EMAIL_VERIFICATION_REQUESTED: 'auth.email_verification.requested',
} as const;

export type AuthEventType = (typeof AUTH_EVENT)[keyof typeof AUTH_EVENT];

export interface MagicLinkEmailPayload {
  email: string;
  magic_link_token: string;
  expires_in_minutes: number;
}

export interface PasswordResetEmailPayload {
  email: string;
  reset_token: string;
  expires_in_minutes: number;
}

export interface EmailVerificationEmailPayload {
  email: string;
  verification_token: string;
  expires_in_hours: number;
}
