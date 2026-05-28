import { createHash, randomBytes } from 'node:crypto';

/**
 * Returns the SHA-256 hex digest of an invitation token. The hash is what gets
 * persisted in `member_invitations.token_hash`; the raw token is never stored
 * so a database leak cannot be replayed.
 */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Produces a fresh 64-character hex invitation token (32 random bytes) used in
 * the magic-link-style accept URL emailed to the invitee.
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('hex');
}
