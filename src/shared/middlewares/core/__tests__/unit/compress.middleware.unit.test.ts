import { describe, it, expect } from 'vitest';
import fastify from 'fastify';
import compressMiddleware from '@/shared/middlewares/core/compress.middleware.js';

/**
 * Build a Fastify app with the compress middleware registered and a single
 * route that returns a long JSON body containing a sensitive field name.
 * The body must be > 1 KB so it exceeds the compression threshold and
 * `@fastify/compress` would otherwise gzip it.
 */
async function buildAppWithSecretRoute(secretValue: string) {
  const app = fastify();
  await app.register(compressMiddleware);
  app.get('/with-secret', async () => {
    const padding = 'x'.repeat(2048);
    return {
      raw_key: secretValue,
      message: `ok ${padding}`,
    };
  });
  app.get('/no-secret', async () => {
    const padding = 'y'.repeat(2048);
    return { message: `plain ${padding}` };
  });
  return app;
}

describe('compress.middleware — sec-re-03: BREACH suppression', () => {
  it('returns Content-Encoding: identity-no-compress when the body contains a sensitive field name', async () => {
    // sec-re-03: the prior fix tried `reply.header('x-no-compression', '1')` —
    // a *response* header. `@fastify/compress` reads the *request* header of
    // that name and silently ignored it, so the BREACH side-channel stayed
    // open. The reliable mechanism is `content-encoding: identity-no-compress`
    // which short-circuits compress's encoding check.
    const app = await buildAppWithSecretRoute('super-secret-value');
    const response = await app.inject({
      method: 'GET',
      url: '/with-secret',
      headers: { 'accept-encoding': 'gzip, br' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-encoding']).toBe('identity-no-compress');
  });

  it('returns the raw JSON body unencoded (first byte is "{", NOT 0x1f 0x8b gzip magic)', async () => {
    const app = await buildAppWithSecretRoute('another-secret');
    const response = await app.inject({
      method: 'GET',
      url: '/with-secret',
      headers: { 'accept-encoding': 'gzip, br' },
    });
    await app.close();

    // gzip magic bytes are 0x1f 0x8b. A non-compressed JSON body starts with '{'.
    const rawBuffer = response.rawPayload;
    expect(rawBuffer[0]).toBe(0x7b);
    expect(rawBuffer[0]).not.toBe(0x1f);

    // And the secret is intact in the body.
    expect(response.body).toContain('another-secret');
  });

  it('sets cache-control no-store on the secret-bearing response', async () => {
    const app = await buildAppWithSecretRoute('cache-probe');
    const response = await app.inject({
      method: 'GET',
      url: '/with-secret',
      headers: { 'accept-encoding': 'gzip' },
    });
    await app.close();

    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['cache-control']).toContain('private');
  });

  it('does NOT alter responses that lack sensitive field names', async () => {
    // The hook must only engage when the body matches the secret-fingerprint
    // matcher. Plain routes still get compressed by fastify-compress.
    const app = await buildAppWithSecretRoute('unused');
    const response = await app.inject({
      method: 'GET',
      url: '/no-secret',
      headers: { 'accept-encoding': 'gzip' },
    });
    await app.close();

    expect(response.headers['content-encoding']).not.toBe('identity-no-compress');
  });
});
