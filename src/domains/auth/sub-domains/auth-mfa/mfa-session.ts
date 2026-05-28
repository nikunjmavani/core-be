import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { UnauthorizedError } from '@/shared/errors/index.js';

import { MFA_SESSION_TTL_SECONDS } from '@/shared/constants/index.js';
/** Redis key prefix for short-lived "password verified, MFA pending" handles handed back to clients between login and `verifyMfa`. */
export const MFA_SESSION_KEY_PREFIX = 'mfa:session:';

/** Payload stored under `mfa:session:<token>` — just the user's public id (no privileges granted until MFA completes). */
export interface MfaSessionPayload {
  user_public_id: string;
}

/** Mints a 32-byte hex MFA session token, stores `{user_public_id}` under `mfa:session:<token>` with {@link MFA_SESSION_TTL_SECONDS} TTL, and returns the token for the client to echo back. */
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

/** Single-use lookup: deletes the Redis entry, parses the JSON payload, and returns the original user public id; throws `UnauthorizedError` (`errors:mfaInvalidOrExpiredSession`) on any failure. */
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
