import { UnauthorizedError } from '@/shared/errors/index.js';

/** The only `users.status` value permitted to mint or refresh an authenticated session. */
export const ACTIVE_USER_STATUS = 'ACTIVE';

/**
 * Rejects any account whose status is not `ACTIVE` before a session is issued.
 *
 * Centralises the suspended/locked guard shared by every session-issuance path
 * (password login, magic-link verify, OAuth completion, WebAuthn verify, and MFA
 * login completion) so a non-active user can never obtain a fresh access token.
 * Throws `UnauthorizedError('errors:accountNotActive')` when the account is not
 * `ACTIVE`; callers should run it after authenticating the factor and before
 * signing a JWT or persisting a session row.
 */
export function assertUserAccountActive(status: string): void {
  if (status !== ACTIVE_USER_STATUS) {
    throw new UnauthorizedError('errors:accountNotActive');
  }
}
