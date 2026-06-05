import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The middleware reads `env.HTTP_SERVER_TIMING_ENABLED` at registration time, so mock the env module
 * with a mutable holder and flip the flag per test before building the app.
 */
const mockEnv = { HTTP_SERVER_TIMING_ENABLED: true };
vi.mock('@/shared/config/env.config.js', () => ({
  get env() {
    return mockEnv;
  },
}));

const { default: serverTimingMiddleware } = await import(
  '@/shared/middlewares/core/server-timing.middleware.js'
);

async function buildApp(): Promise<FastifyInstance> {
  const application = Fastify({ logger: false });
  await application.register(serverTimingMiddleware);
  application.get('/probe', async () => ({ ok: true }));
  await application.ready();
  return application;
}

describe('server-timing.middleware', () => {
  beforeEach(() => {
    mockEnv.HTTP_SERVER_TIMING_ENABLED = true;
  });

  it('sets a well-formed Server-Timing header carrying non-negative server-side ms', async () => {
    const application = await buildApp();
    const response = await application.inject({ method: 'GET', url: '/probe' });

    expect(response.statusCode).toBe(200);
    const header = response.headers['server-timing'];
    expect(header).toMatch(/^app;dur=\d+(\.\d+)?$/);
    const durationMs = Number(String(header).replace('app;dur=', ''));
    expect(durationMs).toBeGreaterThanOrEqual(0);

    await application.close();
  });

  it('applies to every route (global onSend, fastify-plugin un-encapsulated)', async () => {
    const application = Fastify({ logger: false });
    await application.register(serverTimingMiddleware);
    application.get('/a', async () => ({ ok: true }));
    application.get('/b', async () => ({ ok: true }));
    await application.ready();

    for (const url of ['/a', '/b']) {
      const response = await application.inject({ method: 'GET', url });
      expect(response.headers['server-timing'], `${url} must carry Server-Timing`).toMatch(
        /^app;dur=/,
      );
    }
    await application.close();
  });

  it('omits the header when HTTP_SERVER_TIMING_ENABLED is false', async () => {
    mockEnv.HTTP_SERVER_TIMING_ENABLED = false;
    const application = await buildApp();
    const response = await application.inject({ method: 'GET', url: '/probe' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['server-timing']).toBeUndefined();

    await application.close();
  });
});
