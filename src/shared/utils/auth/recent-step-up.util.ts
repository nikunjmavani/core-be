import type { Redis } from 'ioredis';

/** Redis TTL for a successful step-up authentication (MFA verify) before credential mutations. */
export const RECENT_STEP_UP_TTL_SECONDS = 10 * 60;

const RECENT_STEP_UP_KEY_PREFIX = 'step-up:';

/**
 * Composes the Redis key for the step-up sentinel — `step-up:<userPublicId>:<sessionPublicId>`.
 *
 * @remarks
 * The sentinel is per-(user, session), NOT per-user (sec-A2). Without session binding, a
 * holder of a stolen session could wait for the legitimate user's next routine step-up
 * (Account → Add passkey, MFA verify, etc.) and inherit the 10-minute window on every
 * other session for the same user. With binding, only the session that earned the step-up
 * can present it for `requireRecentStepUpPreHandler`.
 */
function buildRecentStepUpKey(userPublicId: string, sessionPublicId: string): string {
  return `${RECENT_STEP_UP_KEY_PREFIX}${userPublicId}:${sessionPublicId}`;
}

/**
 * Records that the user recently completed step-up authentication (e.g. MFA verify) on
 * the specific session that earned it.
 *
 * @remarks Requires a non-empty `sessionPublicId` so the sentinel is per-session (sec-A2);
 * an empty/missing session id is a programming error and would defeat the binding.
 */
export async function recordRecentStepUp(
  redis: Redis,
  userPublicId: string,
  sessionPublicId: string,
): Promise<void> {
  if (!sessionPublicId) {
    throw new Error('recordRecentStepUp requires a non-empty sessionPublicId');
  }
  await redis.set(
    buildRecentStepUpKey(userPublicId, sessionPublicId),
    sessionPublicId,
    'EX',
    RECENT_STEP_UP_TTL_SECONDS,
  );
}

/**
 * Returns true when the given session has a recent step-up within
 * {@link RECENT_STEP_UP_TTL_SECONDS}.
 *
 * @remarks Fails closed when `sessionPublicId` is undefined: returns false so a caller that
 * cannot identify the session never satisfies the gate (sec-A2). This protects against a
 * future regression where an authenticator forgets to populate the session id.
 */
export async function hasRecentStepUp(
  redis: Redis,
  userPublicId: string,
  sessionPublicId: string | undefined,
): Promise<boolean> {
  if (!sessionPublicId) {
    return false;
  }
  const value = await redis.get(buildRecentStepUpKey(userPublicId, sessionPublicId));
  return value !== null;
}
