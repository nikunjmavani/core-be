import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { fastifyCorsPlugin } = vi.hoisted(() => ({
  fastifyCorsPlugin: vi.fn(async () => undefined),
}));

vi.mock('@fastify/cors', () => ({
  default: fastifyCorsPlugin,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    NODE_ENV: 'test',
    ALLOWED_ORIGINS: undefined,
  },
}));

import corsMiddleware from '@/shared/middlewares/cors.middleware.js';

describe('cors.middleware (empty origins)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers CORS with origin disabled when ALLOWED_ORIGINS is unset outside production', async () => {
    const application = Fastify();
    await application.register(corsMiddleware);
    await application.ready();

    const firstCall = fastifyCorsPlugin.mock.calls[0] as unknown[] | undefined;
    const corsOptions = (firstCall?.[1] ?? {}) as { origin: false | string[] };
    expect(corsOptions.origin).toBe(false);
    await application.close();
  });
});
