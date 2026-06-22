/** Event-bus topic codes emitted by the auth-method service so the email handlers can enqueue the corresponding transactional emails. */
export const AUTH_EVENT = {
  MAGIC_LINK_REQUESTED: 'auth.magic_link.requested',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset.requested',
  EMAIL_VERIFICATION_REQUESTED: 'auth.email_verification.requested',
} as const;

/** Union of valid event-bus topic codes in {@link AUTH_EVENT}. */
export type AuthEventType = (typeof AUTH_EVENT)[keyof typeof AUTH_EVENT];

/** Payload of `AUTH_EVENT.MAGIC_LINK_REQUESTED`; carries the 6-digit passwordless sign-in code (persisted only as a hash) and the TTL minutes the email displays. */
export interface MagicLinkEmailPayload {
  email: string;
  otp_code: string;
  expires_in_minutes: number;
}

/** Payload of `AUTH_EVENT.PASSWORD_RESET_REQUESTED`; carries the raw reset token and TTL minutes used to build the password reset link. */
export interface PasswordResetEmailPayload {
  email: string;
  reset_token: string;
  expires_in_minutes: number;
}

/** Payload of `AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED`; carries the 6-digit verification code (persisted only as a hash) and the TTL minutes the email displays. */
export interface EmailVerificationEmailPayload {
  email: string;
  otp_code: string;
  expires_in_minutes: number;
}
