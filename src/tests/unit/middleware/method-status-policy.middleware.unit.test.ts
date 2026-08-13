import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  METHOD_STATUS_POLICY_EXEMPT_PREFIXES,
  registerMethodStatusPolicy,
} from '@/shared/middlewares/core/method-status-policy.middleware.js';

/**
 * The uniform method→status policy (CLAUDE.md, API Contract) is enforced for POST by this
 * single `onSend` hook. It rewrites the status of every non-exempt POST route in the app, so a
 * regression here silently changes the contract for all 60 POST routes at once — while every
 * route still returns a 2xx and no existing assertion necessarily fails.
 */
describe('method-status-policy.middleware', () => {
  let application: FastifyInstance;

  afterEach(async () => {
    if (application) {
      await application.close();
    }
  });

  async function buildApplication(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    registerMethodStatusPolicy(app);

    // POST handlers that each produce one of the rewritable statuses.
    app.post('/post-200', async (_request, reply) => reply.code(200).send({ ok: true }));
    app.post('/post-202', async (_request, reply) => reply.code(202).send({ ok: true }));
    app.post('/post-204', async (_request, reply) => reply.code(204).send());
    app.post('/post-201', async (_request, reply) => reply.code(201).send({ ok: true }));

    // Error statuses must never be touched.
    app.post('/post-400', async (_request, reply) => reply.code(400).send({ ok: false }));
    app.post('/post-409', async (_request, reply) => reply.code(409).send({ ok: false }));
    app.post('/post-500', async (_request, reply) => reply.code(500).send({ ok: false }));

    // Other methods keep their own success statuses.
    app.get('/resource', async (_request, reply) => reply.code(200).send({ ok: true }));
    app.put('/resource', async (_request, reply) => reply.code(200).send({ ok: true }));
    app.patch('/resource', async (_request, reply) => reply.code(200).send({ ok: true }));
    app.delete('/resource', async (_request, reply) => reply.code(204).send());

    // Exempt prefixes — external protocols own these status codes.
    app.post('/api/v1/billing/webhook', async (_request, reply) =>
      reply.code(200).send({ received: true }),
    );
    app.post('/api/v1/mcp', async (_request, reply) => reply.code(200).send({ jsonrpc: '2.0' }));

    // A path that merely CONTAINS an exempt prefix must not inherit the exemption —
    // the guard is a prefix match on the route template, not a substring search.
    app.post('/tenancy/api/v1/mcp', async (_request, reply) => reply.code(200).send({ ok: true }));

    await app.ready();
    return app;
  }

  describe('POST status normalization', () => {
    it.each([
      ['/post-200', 200],
      ['/post-202', 202],
      ['/post-204', 204],
    ])('rewrites a POST handler that produced %s → 201', async (url) => {
      application = await buildApplication();

      const response = await application.inject({ method: 'POST', url });

      expect(response.statusCode).toBe(201);
    });

    it('leaves a POST that already returned 201 untouched', async () => {
      application = await buildApplication();

      const response = await application.inject({ method: 'POST', url: '/post-201' });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ ok: true });
    });

    it('preserves the response body while rewriting the status', async () => {
      application = await buildApplication();

      const response = await application.inject({ method: 'POST', url: '/post-200' });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ ok: true });
    });

    it('turns a bodiless 204 POST into a 201 with an empty body', async () => {
      application = await buildApplication();

      const response = await application.inject({ method: 'POST', url: '/post-204' });

      expect(response.statusCode).toBe(201);
      expect(response.body).toBe('');
    });
  });

  describe('statuses that must never be rewritten', () => {
    it.each([
      ['/post-400', 400],
      ['/post-409', 409],
      ['/post-500', 500],
    ])('leaves POST %s alone (error statuses pass through)', async (url, expected) => {
      application = await buildApplication();

      const response = await application.inject({ method: 'POST', url });

      expect(response.statusCode).toBe(expected);
    });
  });

  describe('non-POST methods', () => {
    it.each([
      ['GET', 200],
      ['PUT', 200],
      ['PATCH', 200],
      ['DELETE', 204],
    ] as const)('leaves %s at its own success status', async (method, expected) => {
      application = await buildApplication();

      const response = await application.inject({ method, url: '/resource' });

      expect(response.statusCode).toBe(expected);
    });
  });

  describe('exempt prefixes', () => {
    it('exports exactly the two documented exemptions', () => {
      // Adding a third exemption is an API-contract decision, not an implementation detail —
      // it must be a deliberate edit to this list, and to the contract docs alongside it.
      expect([...METHOD_STATUS_POLICY_EXEMPT_PREFIXES]).toEqual([
        '/api/v1/billing/webhook',
        '/api/v1/mcp',
      ]);
    });

    it('keeps the Stripe webhook route at 200 so Stripe reads it as acknowledged', async () => {
      application = await buildApplication();

      const response = await application.inject({
        method: 'POST',
        url: '/api/v1/billing/webhook',
      });

      expect(response.statusCode).toBe(200);
    });

    it('keeps the MCP transport route at 200', async () => {
      application = await buildApplication();

      const response = await application.inject({ method: 'POST', url: '/api/v1/mcp' });

      expect(response.statusCode).toBe(200);
    });

    it('does not exempt a route that only contains an exempt prefix mid-path', async () => {
      application = await buildApplication();

      const response = await application.inject({ method: 'POST', url: '/tenancy/api/v1/mcp' });

      expect(response.statusCode).toBe(201);
    });
  });

  describe('unmatched routes', () => {
    it('does not throw when no route matched (routeOptions.url is undefined)', async () => {
      application = await buildApplication();

      // The hook reads `request.routeOptions.url ?? ''`; a 404 has no matched route, so this
      // asserts the nullish fallback keeps the hook from throwing on every unmatched POST.
      const response = await application.inject({ method: 'POST', url: '/does-not-exist' });

      expect(response.statusCode).toBe(404);
    });
  });
});
