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
    ALLOWED_ORIGINS: undefined,
  },
}));

import corsMiddleware from '@/shared/middlewares/cors.middleware.js';

describe('cors.middleware (empty origins)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when ALLOWED_ORIGINS is unset in any environment', async () => {
    const application = Fastify();
    await expect(application.register(corsMiddleware)).rejects.toThrow(
      'ALLOWED_ORIGINS must contain at least one origin',
    );
    expect(fastifyCorsPlugin).not.toHaveBeenCalled();
  });
});
