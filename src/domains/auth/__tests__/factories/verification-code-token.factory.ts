import { database } from '@/infrastructure/database/connection.js';
import { verification_tokens } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.schema.js';
import {
  VERIFICATION_CODE_TTL_MINUTES,
  generateVerificationCode,
  hashVerificationCode,
} from '@/domains/auth/sub-domains/auth-method/verification-code.js';
import { MILLISECONDS_PER_MINUTE } from '@/shared/constants/index.js';

/**
 * Seeds a valid EMAIL_CODE verification code for e2e / integration tests and returns the plaintext
 * code. Only the keyed, user-scoped HMAC is persisted — exactly what the `POST /auth/email/login`
 * consume path (`consumeOtpForUser(user.id, 'EMAIL_CODE', …)`) matches against.
 */
export async function seedEmailVerificationCode(user: {
  id: number;
  email: string;
}): Promise<string> {
  const code = generateVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * MILLISECONDS_PER_MINUTE);

  await database.insert(verification_tokens).values({
    token_type: 'EMAIL_CODE',
    token_hash: hashVerificationCode({ tokenType: 'EMAIL_CODE', userId: user.id, code }),
    user_id: user.id,
    email: user.email,
    expires_at: expiresAt,
  });

  return code;
}
