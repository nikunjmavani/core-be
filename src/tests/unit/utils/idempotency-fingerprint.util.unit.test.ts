import { describe, expect, it } from 'vitest';
import {
  buildIdempotencyRequestFingerprint,
  isIdempotencyRouteExcluded,
  responseBodyContainsSecretFields,
} from '@/shared/utils/idempotency/idempotency-fingerprint.util.js';

describe('buildIdempotencyRequestFingerprint', () => {
  it('differs when method, route, or body change', () => {
    const base = buildIdempotencyRequestFingerprint({
      method: 'POST',
      routePath: '/organizations',
      body: { name: 'A' },
    });
    const differentMethod = buildIdempotencyRequestFingerprint({
      method: 'PUT',
      routePath: '/organizations',
      body: { name: 'A' },
    });
    const differentRoute = buildIdempotencyRequestFingerprint({
      method: 'POST',
      routePath: '/organizations/:id/memberships',
      body: { name: 'A' },
    });
    const differentBody = buildIdempotencyRequestFingerprint({
      method: 'POST',
      routePath: '/organizations',
      body: { name: 'B' },
    });
    expect(differentMethod).not.toBe(base);
    expect(differentRoute).not.toBe(base);
    expect(differentBody).not.toBe(base);
  });
});

describe('isIdempotencyRouteExcluded', () => {
  it('excludes auth token issuance and api-key creation routes', () => {
    expect(isIdempotencyRouteExcluded('/login')).toBe(true);
    expect(isIdempotencyRouteExcluded('/magic-link/verify')).toBe(true);
    expect(isIdempotencyRouteExcluded('/oauth/google/callback')).toBe(true);
    expect(isIdempotencyRouteExcluded('/organizations/:id/api-keys')).toBe(true);
    expect(isIdempotencyRouteExcluded('/tenancy/organizations')).toBe(false);
  });
});

describe('responseBodyContainsSecretFields', () => {
  it('detects token and raw key fields in JSON responses', () => {
    expect(
      responseBodyContainsSecretFields(
        JSON.stringify({ data: { access_token: 'jwt', session_public_id: 'sess' } }),
      ),
    ).toBe(true);
    expect(responseBodyContainsSecretFields(JSON.stringify({ data: { raw_key: 'ak_abc' } }))).toBe(
      true,
    );
    expect(
      responseBodyContainsSecretFields(JSON.stringify({ data: { id: 'org-1', name: 'Acme' } })),
    ).toBe(false);
  });
});
