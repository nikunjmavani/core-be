/** Event-bus topic codes emitted by the auth-method service so the email handlers can enqueue the corresponding transactional emails. */
export const AUTH_EVENT = {
  EMAIL_VERIFICATION_CODE_REQUESTED: 'auth.email_verification_code.requested',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset.requested',
} as const;

/** Union of valid event-bus topic codes in {@link AUTH_EVENT}. */
export type AuthEventType = (typeof AUTH_EVENT)[keyof typeof AUTH_EVENT];

/** Payload of `AUTH_EVENT.EMAIL_VERIFICATION_CODE_REQUESTED`; carries the passwordless sign-in verification code (persisted only as a keyed hash) and the TTL minutes the email displays. */
export interface EmailVerificationCodePayload {
  email: string;
  verification_code: string;
  expires_in_minutes: number;
}

/** Payload of `AUTH_EVENT.PASSWORD_RESET_REQUESTED`; carries the raw reset token and TTL minutes used to build the password reset link. */
export interface PasswordResetEmailPayload {
  email: string;
  reset_token: string;
  expires_in_minutes: number;
}
