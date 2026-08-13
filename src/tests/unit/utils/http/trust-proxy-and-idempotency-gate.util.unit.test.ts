import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { resolveTrustProxy } from '@/shared/utils/http/fastify-server.util.js';
import { isIdempotencyKeyRequiredForRequest } from '@/shared/utils/idempotency/idempotency-required.util.js';
import { env } from '@/shared/config/env.config.js';

/**
 * The proxy-trust resolution and the idempotency route gate.
 *
 * @remarks
 * Both decide something security-relevant from configuration rather than from request content,
 * which is why neither shows up in a route test.
 *
 * `resolveTrustProxy` feeds Fastify's `trustProxy`. Set it too permissively and any client can
 * forge `X-Forwarded-For`, which is the value the rate limiter and audit log treat as the caller's
 * address — so a single attacker appears as unlimited distinct clients. The env schema is what
 * forbids the dangerous spelling: bare `true` (trust every hop) is rejected in favour of an
 * explicit hop count.
 */
describe('resolveTrustProxy', () => {
  it('returns either false or a bounded hop count, never bare true', () => {
    // Fastify accepts `true` and would then trust the leftmost XFF entry — the forgeable one.
    // Whatever the environment is configured with, this must never resolve to that.
    const resolved = resolveTrustProxy();

    expect(resolved).not.toBe(true);
    expect(typeof resolved === 'boolean' || typeof resolved === 'number').toBe(true);
    if (typeof resolved === 'number') {
      expect(Number.isInteger(resolved)).toBe(true);
      expect(resolved).toBeGreaterThanOrEqual(1);
      expect(resolved).toBeLessThanOrEqual(10);
    }
  });

  it('agrees with the parsed environment value', () => {
    // The function is a pass-through with a `false` floor; this pins that it does not
    // reinterpret the env layer's decision, which is where the policy lives.
    const resolved = resolveTrustProxy();

    expect(resolved).toBe(env.TRUST_PROXY === false ? false : env.TRUST_PROXY);
  });

  it('is stable across calls', () => {
    expect(resolveTrustProxy()).toBe(resolveTrustProxy());
  });
});

describe('isIdempotencyKeyRequiredForRequest', () => {
  // The gate deciding whether a write demands X-Idempotency-Key. A false negative lets a retried
  // payment run twice; a false positive rejects a legitimate request with a 422. It reads one
  // explicit route flag and must not infer anything from the method or path.

  function requestWithConfig(config: unknown): FastifyRequest {
    return { routeOptions: { config } } as unknown as FastifyRequest;
  }

  it('returns true only for a route that opted in explicitly', () => {
    expect(
      isIdempotencyKeyRequiredForRequest(requestWithConfig({ idempotencyRequired: true })),
    ).toBe(true);
  });

  it('returns false for a route that did not opt in', () => {
    expect(isIdempotencyKeyRequiredForRequest(requestWithConfig({}))).toBe(false);
  });

  it.each([
    ['the string "true"', 'true'],
    ['1', 1],
    ['an object', {}],
    ['null', null],
    ['undefined', undefined],
  ])('requires a strict boolean true, not %s', (_label, value) => {
    // A truthy-but-not-true value would silently enable the requirement on a route that never
    // asked for it — or, read the other way, a config typo would silently disable it. The strict
    // comparison is the contract.
    expect(
      isIdempotencyKeyRequiredForRequest(requestWithConfig({ idempotencyRequired: value })),
    ).toBe(false);
  });

  it('returns false when the route has no config at all', () => {
    expect(
      isIdempotencyKeyRequiredForRequest({ routeOptions: {} } as unknown as FastifyRequest),
    ).toBe(false);
  });

  it('returns false when routeOptions is absent', () => {
    // 404s and some error paths reach middleware without a matched route; the gate must not throw
    // there, or an unmatched request would 500 instead of 404.
    expect(isIdempotencyKeyRequiredForRequest({} as unknown as FastifyRequest)).toBe(false);
  });

  it('ignores unrelated route config keys', () => {
    expect(
      isIdempotencyKeyRequiredForRequest(
        requestWithConfig({ rateLimit: { max: 5 }, someOtherFlag: true }),
      ),
    ).toBe(false);
  });

  it('does not infer the requirement from the request method', () => {
    // Explicitly documents that this is route-flag driven: a POST without the flag is not
    // idempotency-required, which is what keeps the catalog in docs/routes.txt authoritative.
    const post = {
      method: 'POST',
      routeOptions: { config: {} },
    } as unknown as FastifyRequest;

    expect(isIdempotencyKeyRequiredForRequest(post)).toBe(false);
  });
});
