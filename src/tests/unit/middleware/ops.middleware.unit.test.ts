import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const METRICS_TOKEN_FIXTURE = 'test-metrics-bearer-token-min-32-chars';

vi.mock('@/infrastructure/resilience/circuit-breaker.js', () => {
  const MANAGED_CIRCUIT_BREAKERS = {
    stripe: {
      getState: vi.fn().mockResolvedValue('CLOSED'),
      reset: vi.fn().mockResolvedValue(undefined),
    },
    resend: {
      getState: vi.fn().mockResolvedValue('OPEN'),
      reset: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    MANAGED_CIRCUIT_BREAKERS,
    // EX-03 routed the ops handler through this helper; mirror the real impl over the mocked breakers.
    snapshotManagedCircuitBreakers: vi.fn(async () =>
      Promise.all(
        Object.entries(MANAGED_CIRCUIT_BREAKERS).map(async ([name, circuitBreaker]) => ({
          name,
          state: await circuitBreaker.getState(),
        })),
      ),
    ),
  };
});

const loggerWarnMock = vi.fn();
vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { warn: loggerWarnMock, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('ops.middleware', () => {
  const originalMetricsEnabled = process.env.METRICS_ENABLED;
  const originalMetricsBearer = process.env.METRICS_SCRAPE_TOKEN;

  afterEach(async () => {
    vi.resetModules();
    if (originalMetricsEnabled === undefined) {
      delete process.env.METRICS_ENABLED;
    } else {
      process.env.METRICS_ENABLED = originalMetricsEnabled;
    }
    if (originalMetricsBearer === undefined) {
      delete process.env.METRICS_SCRAPE_TOKEN;
    } else {
      process.env.METRICS_SCRAPE_TOKEN = originalMetricsBearer;
    }
  });

  it('returns 401 without bearer token on circuit breaker list', async () => {
    process.env.METRICS_SCRAPE_TOKEN = METRICS_TOKEN_FIXTURE;
    vi.resetModules();
    const { default: opsMiddleware } = await import('@/shared/middlewares/core/ops.middleware.js');
    const application = Fastify();
    await application.register(opsMiddleware);

    const response = await application.inject({
      method: 'GET',
      url: '/internal/ops/circuit-breakers',
    });
    expect(response.statusCode).toBe(401);
    await application.close();
  });

  it('lists circuit breaker states with valid bearer token', async () => {
    process.env.METRICS_SCRAPE_TOKEN = METRICS_TOKEN_FIXTURE;
    vi.resetModules();
    const { default: opsMiddleware } = await import('@/shared/middlewares/core/ops.middleware.js');
    const application = Fastify();
    await application.register(opsMiddleware);

    const response = await application.inject({
      method: 'GET',
      url: '/internal/ops/circuit-breakers',
      headers: { authorization: `Bearer ${METRICS_TOKEN_FIXTURE}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      circuits: [
        { name: 'stripe', state: 'CLOSED' },
        { name: 'resend', state: 'OPEN' },
      ],
    });
    await application.close();
  });

  it('route-#5: emits an attributable warning when a circuit breaker is reset', async () => {
    process.env.METRICS_SCRAPE_TOKEN = METRICS_TOKEN_FIXTURE;
    vi.resetModules();
    loggerWarnMock.mockClear();
    const { default: opsMiddleware } = await import('@/shared/middlewares/core/ops.middleware.js');
    const application = Fastify();
    await application.register(opsMiddleware);

    const response = await application.inject({
      method: 'POST',
      url: '/internal/ops/circuit-breakers/stripe/reset',
      headers: { authorization: `Bearer ${METRICS_TOKEN_FIXTURE}` },
    });

    expect(response.statusCode).toBe(200);
    // The operator override must be logged with the breaker name (attribution), not silent.
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ circuitName: 'stripe' }),
      'ops.circuit_breaker.reset',
    );
    await application.close();
  });
});
