import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import { getEnv } from '@/shared/config/env.config.js';
import {
  MANAGED_CIRCUIT_BREAKERS,
  type ManagedCircuitBreakerName,
} from '@/infrastructure/resilience/circuit-breaker.js';
import { isBearerTokenValid } from '@/shared/utils/security/bearer-token.util.js';

function requireOpsBearerToken(authorizationHeader: string | undefined): void {
  const bearerToken = getEnv().METRICS_SCRAPE_TOKEN;
  if (!(bearerToken && isBearerTokenValid(authorizationHeader, bearerToken))) {
    throw new UnauthorizedError('errors:invalidMetricsToken');
  }
}

function resolveManagedCircuitBreaker(name: string) {
  if (!(name in MANAGED_CIRCUIT_BREAKERS)) {
    throw new NotFoundError('Circuit breaker');
  }
  return MANAGED_CIRCUIT_BREAKERS[name as ManagedCircuitBreakerName];
}

/**
 * Bearer-protected internal ops routes (reuse `METRICS_SCRAPE_TOKEN`).
 */
const opsMiddleware: FastifyPluginAsync = async (application) => {
  application.get(
    '/internal/ops/circuit-breakers',
    {
      config: { raw_response: true },
      schema: {
        summary: 'List circuit breaker states',
        description:
          'Returns Redis-backed circuit breaker states for Stripe, S3, Resend, and Turnstile. Requires the same bearer token as GET /metrics (`METRICS_SCRAPE_TOKEN`).',
        tags: ['Operations'],
      },
    },
    async (request) => {
      requireOpsBearerToken(request.headers.authorization);
      const circuits = await Promise.all(
        Object.entries(MANAGED_CIRCUIT_BREAKERS).map(async ([name, circuitBreaker]) => ({
          name,
          state: await circuitBreaker.getState(),
        })),
      );
      return { circuits };
    },
  );

  application.post(
    '/internal/ops/circuit-breakers/:circuitName/reset',
    {
      config: { raw_response: true },
      schema: {
        summary: 'Reset a circuit breaker',
        description:
          'Forces a managed circuit breaker back to CLOSED after an operator-verified recovery. Requires the same bearer token as GET /metrics (`METRICS_SCRAPE_TOKEN`).',
        tags: ['Operations'],
      },
    },
    async (request) => {
      requireOpsBearerToken(request.headers.authorization);
      const { circuitName } = request.params as { circuitName: string };
      const circuitBreaker = resolveManagedCircuitBreaker(circuitName);
      await circuitBreaker.reset();
      return { name: circuitName, state: await circuitBreaker.getState() };
    },
  );
};

export default opsMiddleware;
