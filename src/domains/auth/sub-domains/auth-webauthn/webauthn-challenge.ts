import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { WEBAUTHN_CHALLENGE_TTL_SECONDS } from '@/shared/constants/index.js';
import { UnauthorizedError } from '@/shared/errors/index.js';

export const WEBAUTHN_CHALLENGE_KEY_PREFIX = 'webauthn:challenge:';

export type WebauthnChallengeKind = 'registration' | 'authentication';

export interface WebauthnChallengePayload {
  kind: WebauthnChallengeKind;
  user_public_id: string;
  challenge: string;
}

export async function createWebauthnChallenge(
  redis: Redis,
  kind: WebauthnChallengeKind,
  userPublicId: string,
  challenge: string,
): Promise<string> {
  const challengeToken = randomBytes(32).toString('hex');
  const payload: WebauthnChallengePayload = {
    kind,
    user_public_id: userPublicId,
    challenge,
  };
  await redis.set(
    `${WEBAUTHN_CHALLENGE_KEY_PREFIX}${challengeToken}`,
    JSON.stringify(payload),
    'EX',
    WEBAUTHN_CHALLENGE_TTL_SECONDS,
  );
  return challengeToken;
}

export async function consumeWebauthnChallenge(
  redis: Redis,
  challengeToken: string,
  expectedKind: WebauthnChallengeKind,
): Promise<WebauthnChallengePayload> {
  if (!challengeToken || challengeToken.length === 0) {
    throw new UnauthorizedError('errors:webauthnInvalidChallenge');
  }

  const storedPayloadRaw = await redis.get(`${WEBAUTHN_CHALLENGE_KEY_PREFIX}${challengeToken}`);
  if (!storedPayloadRaw) {
    throw new UnauthorizedError('errors:webauthnInvalidChallenge');
  }

  await redis.del(`${WEBAUTHN_CHALLENGE_KEY_PREFIX}${challengeToken}`);

  let storedPayload: WebauthnChallengePayload;
  try {
    storedPayload = JSON.parse(storedPayloadRaw) as WebauthnChallengePayload;
  } catch {
    throw new UnauthorizedError('errors:webauthnInvalidChallenge');
  }

  if (storedPayload.kind !== expectedKind) {
    throw new UnauthorizedError('errors:webauthnInvalidChallenge');
  }

  return storedPayload;
}
