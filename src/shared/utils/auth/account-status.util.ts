import { ForbiddenError, UnauthorizedError } from '@/shared/errors/index.js';

/** The only `users.status` value permitted to mint or refresh an authenticated session. */
export const ACTIVE_USER_STATUS = 'ACTIVE';

/**
 * Subset of the user row needed to authorize a fresh session — `status` plus the
 * `deleted_at` tombstone. Accepting an object (rather than a bare status string) lets
 * callers pass the row they already loaded and lets this guard reject soft-deleted
 * accounts too (sec-U1 defense in depth).
 */
export type AccountActiveInput = {
  status: string;
  deleted_at?: Date | null;
};

/**
 * Rejects any account that is not eligible to mint or refresh an authenticated session.
 *
 * Centralises the suspended/locked/deleted guard shared by every session-issuance path
 * (password login, magic-link verify, OAuth completion, WebAuthn verify, and MFA login
 * completion) so a non-active user can never obtain a fresh access token. Throws
 * `UnauthorizedError('errors:accountNotActive')` when the account is not `ACTIVE` OR
 * when the row carries `deleted_at !== null` (sec-U1 — defense in depth against a
 * token issued seconds before soft-delete being redeemed for a session). Callers
 * should run it after authenticating the factor and before signing a JWT or persisting
 * a session row.
 *
 * @remarks
 * Backward-compatible: callers that still pass a bare status string get the original
 * status-only check. Pass `{ status, deleted_at }` to get the soft-delete check too.
 */
export function assertUserAccountActive(input: string | AccountActiveInput): void {
  const normalized: AccountActiveInput = typeof input === 'string' ? { status: input } : input;
  if (normalized.status !== ACTIVE_USER_STATUS) {
    throw new UnauthorizedError('errors:accountNotActive');
  }
  if (normalized.deleted_at !== undefined && normalized.deleted_at !== null) {
    throw new UnauthorizedError('errors:accountNotActive');
  }
}

/**
 * Refuses login-factor enrollment (MFA TOTP, WebAuthn passkey) until the account's email is verified.
 *
 * @remarks
 * Closes the Trojan-credential account pre-hijacking vector: an attacker who pre-registers a
 * victim's email holds an UNVERIFIED account whose password they set, so a password step-up lets
 * them seed an MFA method or passkey — a factor that survives the victim's password-reset recovery
 * (reset revokes sessions, not enrolled credentials), yielding a silent retained takeover or a
 * lockout. Gating enrollment on email control — the one thing the pre-registering attacker lacks —
 * collapses the attack, mirroring the invitation-accept verified-email gate. Throws
 * `ForbiddenError('errors:emailVerificationRequiredForCredential')` (403) for an unverified account.
 * OAuth linking is guarded separately by the verified-account linking guard in `oauth-user-session`.
 */
export function assertEmailVerifiedForCredentialEnrollment(input: {
  is_email_verified: boolean;
}): void {
  if (!input.is_email_verified) {
    throw new ForbiddenError('errors:emailVerificationRequiredForCredential');
  }
}
