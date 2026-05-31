import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const METRICS_TOKEN_FIXTURE = 'test-metrics-bearer-token-min-32-chars';

vi.mock('@/infrastructure/resilience/circuit-breaker.js', () => ({
  MANAGED_CIRCUIT_BREAKERS: {
    stripe: {
      getState: vi.fn().mockResolvedValue('CLOSED'),
      reset: vi.fn().mockResolvedValue(undefined),
    },
    resend: {
      getState: vi.fn().mockResolvedValue('OPEN'),
      reset: vi.fn().mockResolvedValue(undefined),
    },
  },
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
});
