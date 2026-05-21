import Fastify from 'fastify';
import fp from 'fastify-plugin';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as i18nextHttpMiddleware from 'i18next-http-middleware';

type I18nextHandleMiddleware = (
  request: unknown,
  response: unknown,
  callback: (error?: Error) => void,
) => void;

const i18nextMocks = vi.hoisted(() => ({
  handleImplementation: null as null | (() => I18nextHandleMiddleware),
}));

vi.mock('i18next-http-middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof i18nextHttpMiddleware>();
  return {
    ...actual,
    handle: (...arguments_: Parameters<typeof actual.handle>) => {
      if (i18nextMocks.handleImplementation) {
        return i18nextMocks.handleImplementation();
      }
      return actual.handle(...arguments_);
    },
  };
});

import i18nMiddleware from '@/shared/middlewares/i18n.middleware.js';

async function registerI18nForTests(application: ReturnType<typeof Fastify>): Promise<void> {
  await application.register(fp(i18nMiddleware, { name: 'i18n-middleware-hook-test' }));
}

describe('i18n.middleware (onRequest hook)', () => {
  let application: ReturnType<typeof Fastify>;

  beforeEach(() => {
    i18nextMocks.handleImplementation = null;
  });

  afterEach(async () => {
    if (application) {
      await application.close();
    }
  });

  it('uses the fallback translator when i18next does not attach req.t', async () => {
    i18nextMocks.handleImplementation = () => (_request, _response, callback) => {
      callback();
    };

    application = Fastify({ logger: false });
    await registerI18nForTests(application);
    application.get('/fallback', async (request: { t?: (key: string) => string }) => ({
      translated: (request as { t?: (key: string) => string }).t?.('errors:routeNotFound'),
    }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/fallback' });
    expect(response.statusCode).toBe(200);
    expect(response.json().translated).toBeTruthy();
  });

  it('propagates i18next handler errors through the onRequest hook', async () => {
    i18nextMocks.handleImplementation = () => (_request, _response, callback) => {
      callback(new Error('i18n initialization failed'));
    };

    application = Fastify({ logger: false });
    await registerI18nForTests(application);
    application.get('/should-not-run', async () => ({ ok: true }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/should-not-run' });
    expect(response.statusCode).toBe(500);
  });
});
