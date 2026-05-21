import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { resetMetricsRegistryForTests } from '@/infrastructure/observability/metrics/metrics-registry.js';

describe('Integration: RED HTTP metrics', () => {
  let application: FastifyInstance;
  const previousMetricsEnabled = process.env.METRICS_ENABLED;

  beforeAll(async () => {
    process.env.METRICS_ENABLED = 'true';
    resetEnvCacheForTests();
    const testApplication = await createTestApp();
    application = testApplication.app;
  });

  afterAll(async () => {
    await application.close();
    if (previousMetricsEnabled === undefined) {
      delete process.env.METRICS_ENABLED;
    } else {
      process.env.METRICS_ENABLED = previousMetricsEnabled;
    }
    resetEnvCacheForTests();
    resetMetricsRegistryForTests();
  });

  it('records http_requests_total and http_request_duration_seconds after an HTTP request', async () => {
    const apiResponse = await injectUnauthenticated(application, {
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {},
    });
    expect(apiResponse.statusCode).toBe(400);

    const metricsResponse = await injectUnauthenticated(application, {
      method: 'GET',
      url: '/metrics',
    });

    expect(metricsResponse.statusCode).toBe(200);
    expect(metricsResponse.headers['content-type']).toMatch(/text\/plain/);

    const metricsBody = metricsResponse.body;
    expect(metricsBody).toContain('http_requests_total');
    expect(metricsBody).toContain('http_request_duration_seconds');
    expect(metricsBody).toContain('event_loop_lag_ms{');
    expect(metricsBody).toMatch(/method="POST"/);
    expect(metricsBody).toMatch(/route="\/api\/v1\/auth\/login"/);
    expect(metricsBody).toMatch(/status_code="400"/);
  });
});
