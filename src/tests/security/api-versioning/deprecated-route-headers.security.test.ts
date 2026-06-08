import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';

/**
 * Registry of in-version deprecated route aliases. Every entry MUST emit both
 * `Sunset` (RFC 8594) and `Deprecation` (RFC 9745) response headers on every
 * response — including pre-handler error paths — so external integrators see
 * the deprecation notice regardless of the request shape.
 *
 * sec-r5-tc-4 (audit-2026-06-09): the previous test coverage only pinned the
 * blanket `/api/v1/*` Sunset header (controlled by the `PUBLIC_API_V1_SUNSET`
 * env var). It did NOT pin individual in-version aliases — if a future
 * deprecated route forgot to register `applyDeprecatedEndpointHeaders`, CI
 * would ship the regression silently. This registry-driven test fixes that.
 *
 * Adding a new deprecated alias? Add it here AND register the headers via
 * `onSend` / `applyDeprecatedEndpointHeaders` in the route definition. Both
 * sides are then pinned by this single test.
 */
const DEPRECATED_ALIAS_ROUTES = [
  {
    method: 'POST' as const,
    url: '/api/v1/billing/stripe/webhook',
    description: 'DEPRECATED alias for POST /api/v1/billing/webhook (sec-new-M2)',
    // Will respond with 4xx because no Stripe signature is attached; the
    // headers must still be set via `onSend` regardless of status code.
    expectedResponseStatusCodes: [400, 401, 403, 404, 415, 422, 500],
  },
];

describe('Security: deprecated-route Sunset + Deprecation header inventory (sec-r5-tc-4)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  for (const route of DEPRECATED_ALIAS_ROUTES) {
    it(`${route.method} ${route.url} emits Sunset + Deprecation on every response (${route.description})`, async () => {
      const response = await injectUnauthenticated(app, {
        method: route.method,
        url: route.url,
        payload: { ping: 'deprecation-check' },
        headers: { 'content-type': 'application/json' },
      });

      expect(route.expectedResponseStatusCodes).toContain(response.statusCode);

      const sunset = response.headers.sunset ?? response.headers.Sunset;
      const deprecation = response.headers.deprecation ?? response.headers.Deprecation;

      expect(
        sunset,
        `Sunset header missing from ${route.method} ${route.url} response`,
      ).toBeDefined();
      // RFC 8594: Sunset is an HTTP-date; assert it parses with a reasonable shape.
      expect(String(sunset)).toMatch(
        /^[A-Za-z]{3},\s\d{2}\s[A-Za-z]{3}\s\d{4}\s\d{2}:\d{2}:\d{2}\s(GMT|UTC)$/,
      );
      expect(
        deprecation,
        `Deprecation header missing from ${route.method} ${route.url} response`,
      ).toBeDefined();
      // RFC 9745: Deprecation value is "true" or an HTTP-date when set.
      expect(String(deprecation)).toMatch(/^(true|[A-Za-z]{3},)/);
    });
  }
});
