import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import errorHandlerMiddleware from '@/shared/middlewares/error-handler.middleware.js';

async function createErrorHandlerApplication() {
  const application = Fastify({ logger: false });
  await application.register(errorHandlerMiddleware);
  return application;
}

describe('error-handler.middleware timeouts', () => {
  it('returns 408 for Fastify request timeout errors', async () => {
    const application = await createErrorHandlerApplication();
    application.get('/timeout', async () => {
      const error = new Error('Request timeout') as Error & { code: string };
      error.code = 'FST_ERR_REQ_TIMEOUT';
      throw error;
    });
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/timeout' });
    expect(response.statusCode).toBe(408);
    expect(response.json().error.code).toBe('request_timeout');
    await application.close();
  });

  it('returns 504 for Postgres statement timeout errors', async () => {
    const application = await createErrorHandlerApplication();
    application.get('/database-timeout', async () => {
      const error = new Error('canceling statement due to statement timeout') as Error & {
        code: string;
      };
      error.code = '57014';
      throw error;
    });
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/database-timeout' });
    expect(response.statusCode).toBe(504);
    expect(response.json().error.code).toBe('gateway_timeout');
    await application.close();
  });
});
