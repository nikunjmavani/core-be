import type { Redis } from 'ioredis';

/** Redis TTL for a successful step-up authentication (MFA verify) before credential mutations. */
export const RECENT_STEP_UP_TTL_SECONDS = 10 * 60;

const RECENT_STEP_UP_KEY_PREFIX = 'step-up:';

function buildRecentStepUpKey(userPublicId: string): string {
  return `${RECENT_STEP_UP_KEY_PREFIX}${userPublicId}`;
}

/** Records that the user recently completed step-up authentication (e.g. MFA verify). */
export async function recordRecentStepUp(redis: Redis, userPublicId: string): Promise<void> {
  await redis.set(buildRecentStepUpKey(userPublicId), '1', 'EX', RECENT_STEP_UP_TTL_SECONDS);
}

/** Returns true when the user has a recent step-up session within {@link RECENT_STEP_UP_TTL_SECONDS}. */
export async function hasRecentStepUp(redis: Redis, userPublicId: string): Promise<boolean> {
  const value = await redis.get(buildRecentStepUpKey(userPublicId));
  return value !== null;
}
