import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import responseFormatMiddleware from '@/shared/middlewares/core/response-format.middleware.js';

async function createResponseFormatApp() {
  const application = Fastify({ logger: false });
  await application.register(responseFormatMiddleware);
  application.get('/json', async () => ({ ok: true }));
  application.get('/raw', { config: { raw_response: true } }, async () => ({ ok: true }));
  application.get('/paddle', async () => ({
    data: { id: 'sub_1' },
    meta: { request_id: 'existing-request-id' },
  }));
  application.get('/text', async (_request, reply) => {
    reply.type('text/plain');
    return 'plain-text';
  });
  application.get('/invalid-json-string', async (_request, reply) => {
    reply.type('application/json');
    return '{not-json';
  });
  application.get('/error-json', async (_request, reply) => {
    reply.status(400);
    return { error: 'bad_request' };
  });
  application.get('/json-string-envelope', async (_request, reply) => {
    reply.type('application/json');
    return JSON.stringify({
      data: { id: 'sub_1' },
      meta: { request_id: 'existing-request-id' },
    });
  });
  await application.ready();
  return application;
}

describe('response-format.middleware', () => {
  let application: Awaited<ReturnType<typeof createResponseFormatApp>>;

  afterEach(async () => {
    if (application) {
      await application.close();
    }
  });

  it('wraps JSON object payloads in a data/meta envelope', async () => {
    application = await createResponseFormatApp();
    const response = await application.inject({ method: 'GET', url: '/json' });
    expect(response.json()).toEqual({
      data: { ok: true },
      meta: { request_id: expect.any(String) },
    });
  });

  it('wraps object payloads when content-type is explicitly application/json', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/explicit-json', async (_request, reply) => {
      reply.type('application/json');
      return { value: 42 };
    });
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/explicit-json' });
    expect(response.json()).toEqual({
      data: { value: 42 },
      meta: { request_id: expect.any(String) },
    });
  });

  it('skips wrapping when raw_response is enabled on the route', async () => {
    application = await createResponseFormatApp();
    const response = await application.inject({ method: 'GET', url: '/raw' });
    expect(response.json()).toEqual({ ok: true });
  });

  it('passes through existing Paddle-style envelopes', async () => {
    application = await createResponseFormatApp();
    const response = await application.inject({ method: 'GET', url: '/paddle' });
    expect(response.json()).toEqual({
      data: { id: 'sub_1' },
      meta: { request_id: 'existing-request-id' },
    });
  });

  it('does not wrap non-JSON responses', async () => {
    application = await createResponseFormatApp();
    const response = await application.inject({ method: 'GET', url: '/text' });
    expect(response.body).toBe('plain-text');
  });

  it('returns invalid JSON string bodies unchanged', async () => {
    application = await createResponseFormatApp();
    const response = await application.inject({ method: 'GET', url: '/invalid-json-string' });
    expect(response.body).toBe('{not-json');
  });

  it('does not wrap error responses', async () => {
    application = await createResponseFormatApp();
    const response = await application.inject({ method: 'GET', url: '/error-json' });
    expect(response.json()).toEqual({ error: 'bad_request' });
  });

  it('passes through JSON string bodies that are already envelopes', async () => {
    application = await createResponseFormatApp();
    const response = await application.inject({ method: 'GET', url: '/json-string-envelope' });
    expect(response.json()).toEqual({
      data: { id: 'sub_1' },
      meta: { request_id: 'existing-request-id' },
    });
  });

  it('wraps JSON string payloads that are not already envelopes', async () => {
    application = Fastify({ logger: false }) as FastifyInstance;
    await application.register(responseFormatMiddleware);
    application.get('/json-string', async (_request, reply) => {
      reply.type('application/json');
      return JSON.stringify({ value: 1 });
    });
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/json-string' });
    expect(response.json()).toEqual({
      data: { value: 1 },
      meta: { request_id: expect.any(String) },
    });
  });

  it('does not treat envelopes without a string request_id as Paddle responses', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/invalid-envelope', async () => ({
      data: { ok: true },
      meta: { request_id: 1 },
    }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/invalid-envelope' });
    expect(response.json()).toEqual({
      data: { data: { ok: true }, meta: { request_id: 1 } },
      meta: { request_id: expect.any(String) },
    });
  });

  it('wraps plain objects that are not Paddle envelopes', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/partial-meta', async () => ({ meta: { request_id: 123 } }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/partial-meta' });
    expect(response.json()).toEqual({
      data: { meta: { request_id: 123 } },
      meta: { request_id: expect.any(String) },
    });
  });

  it('wraps plain JSON objects when content-type is unset', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/implicit-json', async () => ({ value: 2 }));
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/implicit-json' });
    expect(response.json()).toEqual({
      data: { value: 2 },
      meta: { request_id: expect.any(String) },
    });
  });

  it('wraps payloads that include meta without data or a string request_id', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/meta-only', async () => ({ meta: { request_id: 1 } }));
    application.get('/data-only', async () => ({ data: { ok: true } }));
    await application.ready();

    const metaOnly = await application.inject({ method: 'GET', url: '/meta-only' });
    expect(metaOnly.json()).toEqual({
      data: { meta: { request_id: 1 } },
      meta: { request_id: expect.any(String) },
    });

    const dataOnly = await application.inject({ method: 'GET', url: '/data-only' });
    expect(dataOnly.json()).toEqual({
      data: { data: { ok: true } },
      meta: { request_id: expect.any(String) },
    });
  });

  it('wraps JSON when content-type includes application/json with charset', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/charset-json', async (_request, reply) => {
      reply.type('application/json; charset=utf-8');
      return { value: 3 };
    });
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/charset-json' });
    expect(response.json()).toEqual({
      data: { value: 3 },
      meta: { request_id: expect.any(String) },
    });
  });

  it('does not wrap when content-type is a string without application/json', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/text-json', async (_request, reply) => {
      reply.type('text/plain');
      return JSON.stringify({ ok: true });
    });
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/text-json' });
    expect(response.body).toBe('{"ok":true}');
  });

  it('does not treat null meta or non-object meta as Paddle envelopes', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/null-meta', async () => ({ data: { ok: true }, meta: null }));
    application.get('/string-meta', async () => ({
      data: { ok: true },
      meta: 'not-an-object',
    }));
    await application.ready();

    const nullMeta = await application.inject({ method: 'GET', url: '/null-meta' });
    expect(nullMeta.json()).toEqual({
      data: { data: { ok: true }, meta: null },
      meta: { request_id: expect.any(String) },
    });

    const stringMeta = await application.inject({ method: 'GET', url: '/string-meta' });
    expect(stringMeta.json()).toEqual({
      data: { data: { ok: true }, meta: 'not-an-object' },
      meta: { request_id: expect.any(String) },
    });
  });

  it('does not wrap when content-type header is not a string', async () => {
    application = Fastify({ logger: false });
    await application.register(responseFormatMiddleware);
    application.get('/typed-json', async (_request, reply) => {
      reply.header('content-type', ['application/json', 'charset=utf-8']);
      return JSON.stringify({ ok: true });
    });
    await application.ready();

    const response = await application.inject({ method: 'GET', url: '/typed-json' });
    expect(response.body).toBe('{"ok":true}');
  });
});
