import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

vi.mock('@/shared/config/env.config.js', () => ({
  env: { NODE_ENV: 'test' },
  getEnv: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  Sentry: { addBreadcrumb: vi.fn() },
}));

import { organizationRoutes } from '@/domains/tenancy/sub-domains/organization/organization.routes.js';

/**
 * Unit tests for the `organizationRoutes` Fastify plugin — specifically the
 * per-route configuration objects (rate-limit presets, idempotency flags).
 *
 * @remarks
 * These tests capture route options via the `onRoute` hook without a real DB
 * or Redis connection. They guard against accidental removal of security
 * configuration from high-value mutation endpoints.
 */

async function buildTestApp(): Promise<{
  app: FastifyInstance;
  capturedRoutes: Map<string, RouteOptions>;
}> {
  const app = Fastify({ logger: false });

  // Register the Zod validator/serializer compilers so Fastify can compile Zod
  // route schemas without throwing on app.ready().
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Decorate app.authenticate so the route plugin can reference it in onRequest.
  // Cast via `as never` to avoid fighting Fastify's decorator type constraint in tests.
  app.decorate('authenticate', vi.fn() as never);

  const capturedRoutes = new Map<string, RouteOptions>();

  // Capture every route's full options before they are finalized.
  app.addHook('onRoute', (routeOptions) => {
    const key = `${routeOptions.method} ${routeOptions.url}`;
    capturedRoutes.set(key, routeOptions as unknown as RouteOptions);
  });

  const stubServices = {
    organizationService: {} as never,
    organizationSettingsService: {} as never,
    organizationNotificationPolicyService: {} as never,
    organizationApiKeyService: {} as never,
    auditService: {} as never,
  };

  await app.register(organizationRoutes(stubServices));
  await app.ready();

  return { app, capturedRoutes };
}

describe('organizationRoutes — route configuration (sec-new-M1)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  // sec-new-M1: POST /organizations was missing the STRICT_AUTHED_RATE_LIMIT config.
  // Org creation is a high-value mutation (provisions DB rows, mints memberships,
  // triggers billing). Without a cap an authenticated user can flood the endpoint.
  it('POST /organizations has rateLimit configured (sec-new-M1)', async () => {
    const { app: testApp, capturedRoutes } = await buildTestApp();
    app = testApp;

    const route = capturedRoutes.get('POST /organizations');
    expect(route, 'POST /organizations route must be registered').toBeDefined();

    const config = route?.config as Record<string, unknown> | undefined;
    expect(
      config?.rateLimit,
      'POST /organizations must carry config.rateLimit (sec-new-M1: missing STRICT_AUTHED_RATE_LIMIT)',
    ).toBeDefined();
  });

  it('POST /organizations preserves idempotencyRequired alongside rateLimit', async () => {
    const { app: testApp, capturedRoutes } = await buildTestApp();
    app = testApp;

    const route = capturedRoutes.get('POST /organizations');
    const config = route?.config as Record<string, unknown> | undefined;

    // Both flags must coexist — a plain spread of STRICT_AUTHED_RATE_LIMIT would
    // have overwritten idempotencyRequired with just the rateLimit config.
    expect(config?.idempotencyRequired).toBe(true);
    expect(config?.rateLimit).toBeDefined();
  });

  // Smoke-check that the rotate key endpoint still has its existing STRICT_AUTHED_RATE_LIMIT.
  // Prevents accidental regressions when refactoring the route config merge pattern.
  it('POST /organization/api-keys/:api_key_id/rotate retains its rateLimit config', async () => {
    const { app: testApp, capturedRoutes } = await buildTestApp();
    app = testApp;

    const route = capturedRoutes.get('POST /organization/api-keys/:api_key_id/rotate');
    const config = route?.config as Record<string, unknown> | undefined;
    expect(config?.rateLimit, 'API key rotate route must carry config.rateLimit').toBeDefined();
  });
});
