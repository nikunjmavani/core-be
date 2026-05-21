import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { UnauthorizedError } from '@/shared/errors/index.js';

import { MFA_SESSION_TTL_SECONDS } from '@/shared/constants/index.js';
export const MFA_SESSION_KEY_PREFIX = 'mfa:session:';

export interface MfaSessionPayload {
  user_public_id: string;
}

export async function createMfaSession(redis: Redis, userPublicId: string): Promise<string> {
  const mfaSessionToken = randomBytes(32).toString('hex');
  const payload: MfaSessionPayload = { user_public_id: userPublicId };
  await redis.set(
    `${MFA_SESSION_KEY_PREFIX}${mfaSessionToken}`,
    JSON.stringify(payload),
    'EX',
    MFA_SESSION_TTL_SECONDS,
  );
  return mfaSessionToken;
}

export async function verifyMfaSession(
  redis: Redis,
  mfaSessionToken: string,
): Promise<MfaSessionPayload> {
  if (!mfaSessionToken || mfaSessionToken.length === 0) {
    throw new UnauthorizedError('errors:mfaInvalidOrExpiredSession');
  }

  const storedPayloadRaw = await redis.get(`${MFA_SESSION_KEY_PREFIX}${mfaSessionToken}`);
  if (!storedPayloadRaw) {
    throw new UnauthorizedError('errors:mfaInvalidOrExpiredSession');
  }

  await redis.del(`${MFA_SESSION_KEY_PREFIX}${mfaSessionToken}`);

  let storedPayload: MfaSessionPayload;
  try {
    storedPayload = JSON.parse(storedPayloadRaw) as MfaSessionPayload;
  } catch {
    throw new UnauthorizedError('errors:mfaInvalidOrExpiredSession');
  }

  if (!storedPayload.user_public_id || storedPayload.user_public_id.length === 0) {
    throw new UnauthorizedError('errors:mfaInvalidOrExpiredSession');
  }

  return storedPayload;
}
