import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getAuthorizedOrganizationId } from '@/shared/middlewares/tenant/tenant.middleware.js';

/**
 * Regression for sec-M7 (Low): downstream middlewares were trusting
 * `request.organizationId` without verifying that `app.authenticate` had
 * run, so a pre-auth attacker could drive org-scoped behaviour (DB lookup,
 * cache key shape, RLS GUC) by setting `X-Organization-Id`. The new helper
 * returns `null` until auth has populated `request.auth`, blocking the
 * pre-auth amplification class.
 *
 * The helper does NOT replace `requireOrganizationPermission` — membership
 * is still validated separately. The only invariant enforced here is
 * "authentication has run for this request".
 */
describe('getAuthorizedOrganizationId (sec-M7)', () => {
  function buildRequest(
    overrides: Partial<{ organizationId: string | null; auth: unknown }>,
  ): FastifyRequest {
    return overrides as unknown as FastifyRequest;
  }

  it('returns null when auth has not run yet (pre-auth surface)', () => {
    const request = buildRequest({ organizationId: 'org_public_abc1234567890', auth: undefined });
    expect(getAuthorizedOrganizationId(request)).toBeNull();
  });

  it('returns null when auth ran but organizationId was never set', () => {
    const request = buildRequest({ organizationId: null, auth: { kind: 'user', userId: 'u' } });
    expect(getAuthorizedOrganizationId(request)).toBeNull();
  });

  it('returns the organizationId when auth has run', () => {
    const request = buildRequest({
      organizationId: 'org_public_abc1234567890',
      auth: { kind: 'user', userId: 'u' },
    });
    expect(getAuthorizedOrganizationId(request)).toBe('org_public_abc1234567890');
  });
});
