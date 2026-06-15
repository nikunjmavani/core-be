import type { FastifyPluginAsync } from 'fastify';
import { NotFoundError, UnauthorizedError } from '@/shared/errors/index.js';
import { getEnv } from '@/shared/config/env.config.js';
import {
  MANAGED_CIRCUIT_BREAKERS,
  type ManagedCircuitBreakerName,
} from '@/infrastructure/resilience/circuit-breaker.js';
import { isBearerTokenValid } from '@/shared/utils/security/bearer-token.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

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
    '/internal/ops/circuit-breakers/:circuit_name/reset',
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
      const { circuit_name: circuitName } = request.params as { circuit_name: string };
      const circuitBreaker = resolveManagedCircuitBreaker(circuitName);
      const previousState = await circuitBreaker.getState();
      await circuitBreaker.reset();
      const newState = await circuitBreaker.getState();
      // route-#5: a manual reset is a security-relevant operator override (it can re-enable calls
      // to a failing/abused provider — e.g. force the captcha or Stripe breaker closed). The ops
      // routes are token-authenticated (no user actor for the audit log), so emit a WARN with the
      // breaker + source IP so the action is attributable in logs/alerting instead of silent.
      logger.warn(
        { circuitName, previousState, newState, sourceIp: request.ip },
        'ops.circuit_breaker.reset',
      );
      return { name: circuitName, state: newState };
    },
  );
};

export default opsMiddleware;
