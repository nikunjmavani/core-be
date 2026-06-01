import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { recordRecentStepUp } from '@/shared/utils/auth/recent-step-up.util.js';

/** Seeds a recent step-up window for integration/e2e tests that call credential routes directly. */
export async function seedRecentStepUpForTestUser(userPublicId: string): Promise<void> {
  await recordRecentStepUp(redisConnection, userPublicId);
}
