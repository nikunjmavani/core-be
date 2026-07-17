import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { recordRecentStepUp, type StepUpFactor } from '@/shared/utils/auth/recent-step-up.util.js';

/**
 * Seeds a recent step-up window for integration/e2e tests that call credential routes directly.
 *
 * @remarks Per sec-A2, the step-up sentinel is bound to a specific session. Tests that
 * use this helper must pass the session's `public_id` so `requireRecentStepUpPreHandler`
 * accepts the bearer associated with that session. Pass the value from the login response
 * (`session_public_id`) or from `request.auth.sessionPublicId` for an authenticated test.
 */
export async function seedRecentStepUpForTestUser(
  userPublicId: string,
  sessionPublicId: string,
  factor: StepUpFactor = 'password',
): Promise<void> {
  await recordRecentStepUp(redisConnection, userPublicId, sessionPublicId, factor);
}
