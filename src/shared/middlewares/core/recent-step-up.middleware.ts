import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError } from '@/shared/errors/index.js';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { requireAuth } from '@/shared/utils/http/request.util.js';
import { hasRecentStepUp } from '@/shared/utils/auth/recent-step-up.util.js';

/**
 * PreHandler that requires the caller to have completed step-up authentication (e.g. MFA verify)
 * within the last ten minutes — on THIS session — before mutating credentials or MFA enrollment.
 *
 * @remarks
 * The check is bound to `(userPublicId, sessionPublicId)` so a stolen-session attacker
 * cannot inherit a step-up that the legitimate user performed on a different session
 * (sec-A2). Fails closed when `sessionPublicId` is absent on `request.auth`.
 */
export async function requireRecentStepUpPreHandler(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const auth = requireAuth(request);
  const steppedUp = await hasRecentStepUp(redisConnection, auth.userId, auth.sessionPublicId);
  if (!steppedUp) {
    throw new ForbiddenError('errors:recentStepUpRequired');
  }
}
