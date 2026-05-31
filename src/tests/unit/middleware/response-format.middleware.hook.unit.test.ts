import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import responseFormatMiddleware from '@/shared/middlewares/core/response-format.middleware.js';

describe('response-format.middleware (onSend hook)', () => {
  let application: ReturnType<typeof Fastify>;

  afterEach(async () => {
    if (application) {
      await application.close();
    }
  });

  it('wraps object payloads before Fastify serializes them to JSON strings', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/probe', async () => ({ hello: 'world' }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/probe' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { hello: 'world' },
      meta: { request_id: expect.any(String) },
    });
  });
});
