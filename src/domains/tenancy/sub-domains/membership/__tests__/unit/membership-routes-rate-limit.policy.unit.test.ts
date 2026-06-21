import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * sec-r4-I3 regression — membership lifecycle routes (leave, transfer-ownership,
 * revoke/resend invitation) must each carry a rate-limit preset. Without these
 * caps a hijacked session could probe membership/invitation existence by status
 * code, churn ownership transfers, or starve a victim org's bucket. (The invitee
 * decline route was removed in REQ-1 — add-member now issues invitations via
 * POST /organization/memberships.)
 */
describe('membership routes rate-limit policy (sec-r4-I3)', () => {
  const membershipRoutesPath = join(
    process.cwd(),
    'src/domains/tenancy/sub-domains/membership/membership.routes.ts',
  );
  const source = readFileSync(membershipRoutesPath, 'utf8');

  function findRouteBlock(httpMethod: string, urlLiteral: string): string {
    const escapedUrl = urlLiteral.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Allow optional generic args (e.g. app.post<{ Params: ... }>(...))
    const pattern = new RegExp(
      `(?:zodApplication|app)\\.${httpMethod}(?:<[^>]*>)?\\(\\s*'${escapedUrl}',\\s*\\{([\\s\\S]*?)\\n\\s{4,6}\\},\\n\\s{4,6}\\w`,
      'm',
    );
    const match = source.match(pattern);
    if (!match) {
      throw new Error(`route block not found: ${httpMethod.toUpperCase()} ${urlLiteral}`);
    }
    return match[1] ?? '';
  }

  it('POST /organization/leave has MODERATE_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteBlock('post', '/organization/leave')).toContain(
      '...MODERATE_AUTHED_RATE_LIMIT',
    );
  });

  it('POST /organization/transfer-ownership has EXPENSIVE_AUTHED_RATE_LIMIT applied (irreversible)', () => {
    // Merged into a single config object to preserve idempotencyRequired.
    expect(findRouteBlock('post', '/organization/transfer-ownership')).toContain(
      'EXPENSIVE_AUTHED_RATE_LIMIT.config',
    );
  });

  it('DELETE /organization/invitations/:invitation_id has ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT', () => {
    expect(findRouteBlock('delete', '/organization/invitations/:invitation_id')).toContain(
      '...ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT',
    );
  });

  it('POST /organization/invitations/:invitation_id/resend has STRICT_AUTHED_RATE_LIMIT applied', () => {
    expect(findRouteBlock('post', '/organization/invitations/:invitation_id/resend')).toContain(
      '...STRICT_AUTHED_RATE_LIMIT',
    );
  });
});
