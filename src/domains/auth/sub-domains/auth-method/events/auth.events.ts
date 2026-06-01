/** Event-bus topic codes emitted by the auth-method service so the email handlers can enqueue the corresponding transactional emails. */
export const AUTH_EVENT = {
  MAGIC_LINK_REQUESTED: 'auth.magic_link.requested',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset.requested',
  EMAIL_VERIFICATION_REQUESTED: 'auth.email_verification.requested',
} as const;

/** Union of valid event-bus topic codes in {@link AUTH_EVENT}. */
export type AuthEventType = (typeof AUTH_EVENT)[keyof typeof AUTH_EVENT];

/** Payload of `AUTH_EVENT.MAGIC_LINK_REQUESTED`; carries the raw token (only persisted in-flight) and TTL minutes that the email handler interpolates into the verify URL. */
export interface MagicLinkEmailPayload {
  email: string;
  magic_link_token: string;
  expires_in_minutes: number;
}

/** Payload of `AUTH_EVENT.PASSWORD_RESET_REQUESTED`; carries the raw reset token and TTL minutes used to build the password reset link. */
export interface PasswordResetEmailPayload {
  email: string;
  reset_token: string;
  expires_in_minutes: number;
}

/** Payload of `AUTH_EVENT.EMAIL_VERIFICATION_REQUESTED`; carries the raw verification token and TTL hours used to build the email verify link. */
export interface EmailVerificationEmailPayload {
  email: string;
  verification_token: string;
  expires_in_hours: number;
}
