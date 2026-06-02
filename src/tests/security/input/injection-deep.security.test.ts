import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';

/**
 * Deep injection guards: prototype pollution and type confusion.
 *
 * Tests run in-process via `fastify.inject()`, so a successful prototype-pollution
 * attack would also pollute THIS process's `Object.prototype` — which lets us
 * assert the strongest possible invariant: after sending a hostile `__proto__` /
 * `constructor` payload, a freshly created object must NOT carry the injected key.
 * Type-confusion payloads (an object/array where a string is expected, NoSQL-style
 * operators) must be rejected cleanly (4xx), never crash the handler (5xx).
 */
const LOGIN = '/auth/login';

/** Asserts no global prototype pollution leaked from the request. */
function expectNoPrototypePollution(): void {
  const probe = {} as Record<string, unknown>;
  expect(probe.polluted).toBeUndefined();
  expect(probe.isAdmin).toBeUndefined();
  expect(probe.role).toBeUndefined();
  expect(({} as { constructor?: { polluted?: unknown } }).constructor?.polluted).toBeUndefined();
}

describe('Security: deep injection (prototype pollution / type confusion)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  async function postLogin(payload: unknown): Promise<number> {
    const response = await injectUnauthenticated(app, {
      method: 'POST',
      url: testApiPath(LOGIN),
      payload,
    });
    return response.statusCode;
  }

  // ─── Prototype pollution ────────────────────────────────────────────────────

  describe('prototype pollution', () => {
    it('neutralizes a top-level __proto__ payload (no crash, no global pollution)', async () => {
      const status = await postLogin({
        email: 'attacker@example.com',
        password: 'whatever',
        __proto__: { polluted: 'yes', isAdmin: true },
      });
      expect(status).toBeLessThan(500);
      expectNoPrototypePollution();
    });

    it('neutralizes a constructor.prototype payload', async () => {
      const status = await postLogin({
        email: 'attacker@example.com',
        password: 'whatever',
        constructor: { prototype: { polluted: 'yes', role: 'super_admin' } },
      });
      expect(status).toBeLessThan(500);
      expectNoPrototypePollution();
    });

    it('neutralizes a nested __proto__ inside a field', async () => {
      const status = await postLogin({
        email: { __proto__: { polluted: 'yes' } },
        password: 'whatever',
      });
      expect(status).toBeLessThan(500);
      expectNoPrototypePollution();
    });

    it('neutralizes a raw JSON string carrying __proto__', async () => {
      // Send the literal JSON so `__proto__` survives serialization (an object
      // literal would set the prototype, not an own key).
      const response = await injectUnauthenticated(app, {
        method: 'POST',
        url: testApiPath(LOGIN),
        headers: { 'content-type': 'application/json' },
        payload: '{"email":"a@b.com","password":"x","__proto__":{"polluted":"yes","isAdmin":true}}',
      });
      expect(response.statusCode).toBeLessThan(500);
      expectNoPrototypePollution();
    });
  });

  // ─── Type confusion ─────────────────────────────────────────────────────────

  describe('type confusion', () => {
    it('rejects an object where a string is expected (NoSQL-style operator)', async () => {
      const status = await postLogin({
        email: { $gt: '' },
        password: { $ne: null },
      });
      expect([400, 422]).toContain(status);
    });

    it('rejects an array where a string is expected', async () => {
      const status = await postLogin({
        email: ['a@b.com', 'c@d.com'],
        password: 'whatever',
      });
      expect([400, 422]).toContain(status);
    });

    it('rejects a numeric/boolean where a string is expected', async () => {
      for (const email of [12345, true, null]) {
        const status = await postLogin({ email, password: 'whatever' });
        expect([400, 422]).toContain(status);
      }
    });
  });
});
