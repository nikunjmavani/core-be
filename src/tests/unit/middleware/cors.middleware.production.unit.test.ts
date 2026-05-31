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
    ALLOWED_ORIGINS: '',
  },
}));

import corsMiddleware from '@/shared/middlewares/security/cors.middleware.js';

describe('cors.middleware (required origins)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when ALLOWED_ORIGINS is empty in any environment', async () => {
    const application = Fastify();
    await expect(application.register(corsMiddleware)).rejects.toThrow(
      'ALLOWED_ORIGINS must contain at least one origin',
    );
  });
});
