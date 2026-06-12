import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import { routeSuccessStatusKey } from '@/tests/helpers/route-success-status.helper.js';
import { ROUTE_EXAMPLES_PATH } from '@tooling/openapi/route-examples/constants.js';

/**
 * Guards the committed captured-example fixture (`pnpm routes:examples`):
 * every key must be a catalog route, and no value may contain secret-shaped
 * material — the sanitizer must have replaced JWTs, Stripe-style secrets,
 * provisioning URIs, long hex blobs, and real email addresses before commit.
 */
describe('captured route examples fixture', () => {
  const fixturePath = resolve(process.cwd(), ROUTE_EXAMPLES_PATH);
  const fixtureExists = existsSync(fixturePath);
  const fixture: Record<string, { responses: Record<string, unknown> }> = fixtureExists
    ? JSON.parse(readFileSync(fixturePath, 'utf-8'))
    : {};

  it('keys every entry to a catalog route', () => {
    const catalogKeys = new Set(
      loadRouteRegistryFromCatalog().map((route) => routeSuccessStatusKey(route)),
    );
    const deadKeys = Object.keys(fixture).filter((key) => !catalogKeys.has(key));
    expect(deadKeys, `Example keys without a catalog route:\n${deadKeys.join('\n')}`).toEqual([]);
  });

  it('contains no secret-shaped values or real email addresses', () => {
    if (!fixtureExists) {
      return;
    }
    const raw = readFileSync(fixturePath, 'utf-8');
    const leakPatterns: Array<[string, RegExp]> = [
      ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
      ['Stripe-style secret', /"(sk|whsec|rk)_[A-Za-z0-9_]{8,}"/],
      ['prefixed opaque credential', /"[a-z]{2,8}_[A-Za-z0-9]{16,}"/],
      ['otpauth URI', /otpauth:\/\//],
      ['long hex blob', /"[A-Fa-f0-9]{40,}"/],
      ['non-placeholder email', /"[^"\s@]+@(?!example\.com")[^"\s@]+\.[^"\s@]+"/],
      ['bearer header value', /"Bearer [A-Za-z0-9]/],
    ];
    const leaks = leakPatterns.filter(([, pattern]) => pattern.test(raw)).map(([label]) => label);
    expect(leaks, `Secret-shaped material found in fixture: ${leaks.join(', ')}`).toEqual([]);
  });

  it('only contains sub-500 response statuses', () => {
    const invalid = Object.entries(fixture).flatMap(([key, entry]) =>
      Object.keys(entry.responses ?? {})
        .filter((status) => Number(status) >= 500 || Number.isNaN(Number(status)))
        .map((status) => `${key} → ${status}`),
    );
    expect(invalid).toEqual([]);
  });
});
