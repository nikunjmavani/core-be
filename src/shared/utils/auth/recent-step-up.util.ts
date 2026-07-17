import type { Redis } from 'ioredis';

/** Redis TTL for a successful step-up authentication (MFA verify) before credential mutations. */
export const RECENT_STEP_UP_TTL_SECONDS = 10 * 60;

/**
 * The factor a caller used to complete step-up. Stored as the sentinel value so a
 * destructive-mutation gate can require a STRONG factor.
 *
 * @remarks `email_code` is a bootstrap-only factor (a passwordless account enrolling its FIRST
 * MFA/passkey). It CANNOT satisfy {@link hasRecentStrongStepUp}, so an email-code step-up window
 * can enroll a factor but can never revoke a session or delete a credential.
 */
export const STEP_UP_FACTORS = ['password', 'mfa', 'email_code'] as const;
/** A factor accepted by `POST /auth/step-up` / MFA verify — see {@link STEP_UP_FACTORS}. */
export type StepUpFactor = (typeof STEP_UP_FACTORS)[number];

/** Factors strong enough to authorize destructive credential/session mutations (never `email_code`). */
const STRONG_STEP_UP_FACTORS: readonly StepUpFactor[] = ['password', 'mfa'];

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
 * Records that the user recently completed step-up authentication on the specific session that
 * earned it, tagging the sentinel with the {@link StepUpFactor} used.
 *
 * @remarks Requires a non-empty `sessionPublicId` so the sentinel is per-session (sec-A2);
 * an empty/missing session id is a programming error and would defeat the binding. The stored
 * value is the factor (not the session id) so {@link hasRecentStrongStepUp} can exclude
 * `email_code` windows from destructive mutations.
 */
export async function recordRecentStepUp(
  redis: Redis,
  userPublicId: string,
  sessionPublicId: string,
  factor: StepUpFactor,
): Promise<void> {
  if (!sessionPublicId) {
    throw new Error('recordRecentStepUp requires a non-empty sessionPublicId');
  }
  await redis.set(
    buildRecentStepUpKey(userPublicId, sessionPublicId),
    factor,
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

/**
 * Returns true only when the session's recent step-up was completed via a STRONG factor
 * (`password` or `mfa`) — used to gate destructive credential/session mutations.
 *
 * @remarks Excludes `email_code` bootstrap windows: a passwordless account may open a step-up
 * window with an email code to enroll its first MFA/passkey, but must NOT be able to revoke
 * sessions or delete credentials on that weaker factor. Fails closed on a missing session id,
 * and on a legacy sentinel written before factors were tracked (its value is a session id, not a
 * factor, so it reads as non-strong until the 10-minute TTL lapses).
 */
export async function hasRecentStrongStepUp(
  redis: Redis,
  userPublicId: string,
  sessionPublicId: string | undefined,
): Promise<boolean> {
  if (!sessionPublicId) {
    return false;
  }
  const value = await redis.get(buildRecentStepUpKey(userPublicId, sessionPublicId));
  return value !== null && STRONG_STEP_UP_FACTORS.includes(value as StepUpFactor);
}
