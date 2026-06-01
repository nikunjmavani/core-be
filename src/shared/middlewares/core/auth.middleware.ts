import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { verifyAccessToken } from '@/shared/utils/security/jwt.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { AuthContext } from '@/shared/types/index.js';
import type { GlobalRole } from '@/shared/constants/roles.constants.js';
import { applyApiKeyAuthentication } from '@/shared/middlewares/security/api-key-auth.middleware.js';

function getBearerToken(request: FastifyRequest): string {
  const authorizationHeader = request.headers.authorization;
  if (!authorizationHeader) throw new UnauthorizedError('errors:missingAuthorizationHeader');
  const match = authorizationHeader.match(/^Bearer\s+(\S.*)$/i);
  if (!match) throw new UnauthorizedError('errors:invalidAuthorizationHeaderFormat');
  return match[1]!;
}

async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (request.auth) {
    return;
  }

  const apiKeyAuthenticated = await applyApiKeyAuthentication(request);
  if (apiKeyAuthenticated) {
    return;
  }

  const token = getBearerToken(request);

  try {
    const payload = await verifyAccessToken(token);

    const authSessionService = request.server.authDomain?.authSessionService;
    if (!authSessionService) {
      throw new UnauthorizedError('errors:validation.invalidToken');
    }

    await authSessionService.verifyActiveAccessToken(token);

    request.auth = omitUndefined({
      kind: 'user',
      userId: payload.userId,
      role: payload.role ? (payload.role as GlobalRole) : undefined,
    }) as AuthContext;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    throw new UnauthorizedError('errors:validation.invalidToken');
  }
}

const authMiddleware: FastifyPluginAsync = async (app) => {
  app.decorateRequest('auth', null);
  app.decorate('authenticate', authenticate);
};

export default fp(authMiddleware, { name: 'auth-middleware' });
