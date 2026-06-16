import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  discoverSubdomainFoldersWithRoutes,
  findMissingSubdomainIntegrationTests,
  SUBDOMAIN_HTTP_INTEGRATION_WITHOUT_ROUTES,
} from '@/scripts/validators/routes/route-http-coverage-validation.util.js';

const DOMAINS_DIR = resolve(process.cwd(), 'src/domains');

describe('subdomain integration policy', () => {
  it('discovers every sub-domain with a routes file', () => {
    const folders = discoverSubdomainFoldersWithRoutes(DOMAINS_DIR);
    const resources = folders.map((entry) => `${entry.domain}/${entry.resource}`).sort();
    expect(resources).toContain('billing/plan');
    expect(resources).toContain('tenancy/organization');
    expect(resources).toContain('notify/webhook');
    /**
     * Nested resources (e.g. member-invitation, organization-api-key, webhook-event) are HTTP-served
     * by their parent sub-domain's routes file and are tracked in
     * SUBDOMAIN_HTTP_INTEGRATION_WITHOUT_ROUTES instead.
     */
    expect(resources.length).toBeGreaterThanOrEqual(9);
  });

  it('requires co-located integration tests for routes and listed HTTP handlers', () => {
    expect(findMissingSubdomainIntegrationTests(DOMAINS_DIR)).toEqual([]);
  });

  it('lists every without-routes HTTP sub-domain from the domain map', () => {
    const entries = SUBDOMAIN_HTTP_INTEGRATION_WITHOUT_ROUTES.map(
      (entry) => `${entry.domain}/${entry.resource}`,
    ).sort();
    expect(entries).toEqual([
      'auth/auth-method',
      'auth/auth-session',
      'auth/mfa',
      'auth/webauthn',
      'notify/webhook-event',
      'tenancy/member-invitation',
      'tenancy/member-role-permission',
      'tenancy/organization-api-key',
      'tenancy/organization-notification-policy',
      'tenancy/organization-settings',
      'user/user-data-export',
      'user/user-notification-preferences',
      'user/user-settings',
    ]);
  });
});
