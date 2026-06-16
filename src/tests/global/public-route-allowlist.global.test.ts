import { describe, expect, it } from 'vitest';
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';

/**
 * Public-route allowlist pin.
 *
 * The set of unauthenticated (`PUBLIC`) routes must EXACTLY match the hand-maintained
 * allowlist below. A new route accidentally registered without authentication — or
 * authentication silently dropped from an existing route — changes the `PUBLIC` set in
 * `docs/routes.txt` and fails this test. Combined with `routes:catalog:check` (which keeps
 * the catalog in sync with the actual route registrations), this makes "exposing a route
 * to the public internet" a deliberate, reviewed decision rather than an accident.
 *
 * To intentionally add or remove a public route, update `EXPECTED_PUBLIC_ROUTES` in the
 * same change — the diff is the audit record.
 */

// Keep sorted (`METHOD path`) for readable diffs. Every entry is an unauthenticated route.
const EXPECTED_PUBLIC_ROUTES: readonly string[] = [
  // Liveness / readiness probes (no body, no secrets).
  'GET /livez',
  'GET /readyz',
  // Auth — unauthenticated credential / token issuance, OAuth, and passkey login.
  'GET /api/v1/auth/oauth/:provider',
  'GET /api/v1/auth/oauth/:provider/callback',
  'GET /api/v1/auth/oauth/providers',
  'POST /api/v1/auth/email/verify',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/magic-link/send',
  'POST /api/v1/auth/magic-link/verify',
  'POST /api/v1/auth/mfa/login',
  'POST /api/v1/auth/password/forgot',
  'POST /api/v1/auth/password/reset',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/webauthn/authenticate/options',
  'POST /api/v1/auth/webauthn/authenticate/verify',
  // Billing — public plan catalog + Stripe-signature-verified webhook ingress
  // (`/billing/webhook` is canonical; `/billing/stripe/webhook` is the deprecated alias —
  // both sit behind the raw-body HMAC verification preHandler, see stripe-webhook.routes.ts).
  'GET /api/v1/billing/plans',
  'GET /api/v1/billing/plans/:plan_id',
  'POST /api/v1/billing/stripe/webhook',
  'POST /api/v1/billing/webhook',
];

describe('Security: public route allowlist', () => {
  const actualPublicRoutes = loadRouteRegistryFromCatalog()
    .filter((route) => route.access === 'public')
    .map((route) => `${route.method} ${route.path}`)
    .sort();
  const expectedPublicRoutes = [...EXPECTED_PUBLIC_ROUTES].sort();

  it('exposes exactly the reviewed set of unauthenticated routes', () => {
    const newlyPublic = actualPublicRoutes.filter((route) => !expectedPublicRoutes.includes(route));
    const noLongerPublic = expectedPublicRoutes.filter(
      (route) => !actualPublicRoutes.includes(route),
    );

    expect(
      { newlyPublic, noLongerPublic },
      'Public-route surface drifted from the allowlist. ' +
        `Newly PUBLIC (must be a deliberate, security-reviewed decision): ${
          newlyPublic.join(', ') || 'none'
        }. No longer PUBLIC: ${noLongerPublic.join(', ') || 'none'}. ` +
        'If intended, update EXPECTED_PUBLIC_ROUTES; otherwise add authentication to the route.',
    ).toEqual({ newlyPublic: [], noLongerPublic: [] });
  });

  it('keeps the public surface bounded (guards against a broad accidental opening)', () => {
    expect(actualPublicRoutes).toHaveLength(EXPECTED_PUBLIC_ROUTES.length);
  });
});
