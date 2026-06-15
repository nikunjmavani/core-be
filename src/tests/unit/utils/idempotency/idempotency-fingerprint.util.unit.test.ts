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
      routePath: '/api/v1/tenancy/organization/memberships',
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
  // Matched against the full prefixed Fastify route template (request.routeOptions.url), e.g.
  // `/api/v1/auth/login` — the patterns are suffix-anchored so the /api/v{n} prefix is irrelevant.
  it('excludes auth token issuance and api-key creation routes', () => {
    expect(isIdempotencyRouteExcluded('/api/v1/auth/login')).toBe(true);
    expect(isIdempotencyRouteExcluded('/api/v1/auth/magic-link/verify')).toBe(true);
    expect(isIdempotencyRouteExcluded('/api/v1/auth/mfa/login')).toBe(true);
    expect(isIdempotencyRouteExcluded('/api/v1/auth/oauth/google/callback')).toBe(true);
    expect(isIdempotencyRouteExcluded('/api/v1/auth/webauthn/authenticate/verify')).toBe(true);
    expect(isIdempotencyRouteExcluded('/api/v1/auth/refresh')).toBe(true);
    expect(isIdempotencyRouteExcluded('/api/v1/tenancy/organization/api-keys')).toBe(true);
  });

  it('does not exclude account-level or non-issuance routes', () => {
    expect(isIdempotencyRouteExcluded('/api/v1/tenancy/organizations')).toBe(false);
    expect(isIdempotencyRouteExcluded('/api/v1/tenancy/organization/memberships')).toBe(false);
    expect(isIdempotencyRouteExcluded('/api/v1/billing/subscriptions')).toBe(false);
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

  it('route-audit-#3: flags recovery codes and presigned-URL fields (no-store + no idempotency cache)', () => {
    // MFA recovery codes — plaintext single-use MFA-bypass material.
    expect(
      responseBodyContainsSecretFields(
        JSON.stringify({ data: { recovery_codes: ['ABCD-1234'], method_public_id: 'm1' } }),
      ),
    ).toBe(true);
    // GDPR data-export presigned download URL (carries X-Amz-Signature).
    expect(
      responseBodyContainsSecretFields(
        JSON.stringify({ data: { download_url: 'https://s3/...' } }),
      ),
    ).toBe(true);
    // Upload presign URL.
    expect(
      responseBodyContainsSecretFields(JSON.stringify({ data: { uploadUrl: 'https://s3/...' } })),
    ).toBe(true);
  });
});
