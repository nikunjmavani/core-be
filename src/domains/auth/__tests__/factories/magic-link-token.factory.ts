import { database } from '@/infrastructure/database/connection.js';
import { verification_tokens } from '@/domains/auth/sub-domains/auth-method/verification-token/verification-token.schema.js';
import {
  generateEmailOtp,
  hashEmailOtp,
} from '@/domains/auth/sub-domains/auth-method/email-otp.js';
import {
  MAGIC_LINK_EXPIRES_IN_MINUTES,
  MILLISECONDS_PER_MINUTE,
} from '@/shared/constants/index.js';

/**
 * Seeds a valid MAGIC_LINK verification code (6-digit OTP) for e2e / integration tests and returns
 * the plaintext code. Only `sha256(code)` is persisted, scoped to the user — exactly what the
 * `POST /auth/magic-link/verify` consume path (`consumeOtpForUser(user.id, 'MAGIC_LINK', …)`)
 * matches against.
 */
export async function seedMagicLinkVerificationCode(user: {
  id: number;
  email: string;
}): Promise<string> {
  const code = generateEmailOtp();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRES_IN_MINUTES * MILLISECONDS_PER_MINUTE);

  await database.insert(verification_tokens).values({
    token_type: 'MAGIC_LINK',
    token_hash: hashEmailOtp(code),
    user_id: user.id,
    email: user.email,
    expires_at: expiresAt,
  });

  return code;
}
