import { createHash, randomBytes } from 'node:crypto';

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateInvitationToken(): string {
  return randomBytes(32).toString('hex');
}
