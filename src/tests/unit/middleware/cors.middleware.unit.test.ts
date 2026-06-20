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
    ALLOWED_ORIGINS: 'https://app.example.com,https://admin.example.com',
  },
}));

import corsMiddleware from '@/shared/middlewares/security/cors.middleware.js';

describe('cors.middleware', () => {
  let application: ReturnType<typeof Fastify>;

  afterEach(async () => {
    vi.clearAllMocks();
    if (application) {
      await application.close();
    }
  });

  it('registers CORS with parsed allowed origins', async () => {
    application = Fastify();
    const registerSpy = vi.spyOn(application, 'register');
    await application.register(corsMiddleware);
    await application.ready();

    expect(fastifyCorsPlugin).toHaveBeenCalled();
    expect(registerSpy).toHaveBeenCalledWith(
      fastifyCorsPlugin,
      expect.objectContaining({
        origin: ['https://app.example.com', 'https://admin.example.com'],
        credentials: true,
        allowedHeaders: expect.arrayContaining(['X-Captcha-Token']),
      }),
    );
  });

  it('exposes Retry-After so cross-origin clients can read it on 429/503 (EX-11)', async () => {
    application = Fastify();
    const registerSpy = vi.spyOn(application, 'register');
    await application.register(corsMiddleware);
    await application.ready();

    expect(registerSpy).toHaveBeenCalledWith(
      fastifyCorsPlugin,
      expect.objectContaining({
        exposedHeaders: expect.arrayContaining(['Retry-After']),
      }),
    );
  });
});
