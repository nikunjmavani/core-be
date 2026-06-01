import { createHash, randomBytes } from 'node:crypto';
import { database } from '@/infrastructure/database/connection.js';
import { verification_tokens } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.schema.js';
import {
  MAGIC_LINK_EXPIRES_IN_MINUTES,
  MILLISECONDS_PER_MINUTE,
} from '@/shared/constants/index.js';

/** Seeds a valid MAGIC_LINK verification token for e2e / integration tests. */
export async function seedMagicLinkVerificationToken(user: {
  id: number;
  email: string;
}): Promise<string> {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRES_IN_MINUTES * MILLISECONDS_PER_MINUTE);

  await database.insert(verification_tokens).values({
    token_type: 'MAGIC_LINK',
    token_hash: tokenHash,
    user_id: user.id,
    email: user.email,
    expires_at: expiresAt,
  });

  return rawToken;
}
