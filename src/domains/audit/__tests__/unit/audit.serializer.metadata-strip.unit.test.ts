import { describe, it, expect } from 'vitest';
import { AuditSerializer } from '@/domains/audit/audit.serializer.js';

/**
 * Regression for sec-U2 (High, forensics blind): the old serializer stripped
 * every key ending in `_id` from `metadata` — including the public ids the
 * audit writers actually persist (`session_public_id`, `role_public_id`,
 * `organization_id` for Stripe). Admins reading the audit feed saw metadata
 * scrubbed of the only fields linking a recorded action to the resource it
 * touched.
 *
 * The new serializer keeps a small denylist of keys whose VALUE today is an
 * internal numeric surrogate (`auth_method_id`, `mfa_method_id`). Everything
 * else — including public-id fields — flows through. This is forward-safe: a
 * future writer that stores another internal id is added to the denylist.
 */
describe('AuditSerializer — metadata identifier stripping (denylist)', () => {
  it('strips only known internal-id keys; public-id keys flow through', () => {
    const items = AuditSerializer.many([
      {
        public_id: 'log_public_abc',
        metadata: {
          // Internal numeric surrogates — must be stripped.
          auth_method_id: 99,
          mfa_method_id: 17,
          // Public ids the writers actually persist — must survive.
          session_public_id: 'sess_pub_xyz',
          role_public_id: 'role_pub_abc',
          organization_id: 'org_pub_def',
          // Free-form context — must survive.
          action_detail: 'role changed',
        },
      },
    ]);

    expect(items[0]?.metadata).toEqual({
      session_public_id: 'sess_pub_xyz',
      role_public_id: 'role_pub_abc',
      organization_id: 'org_pub_def',
      action_detail: 'role changed',
    });
  });

  it('keeps non-identifier metadata fields untouched', () => {
    const items = AuditSerializer.many([
      {
        public_id: 'log_public_def',
        metadata: { channel: 'email', severity: 'info' },
      },
    ]);

    expect(items[0]?.metadata).toEqual({ channel: 'email', severity: 'info' });
  });

  it('returns null metadata unchanged', () => {
    const items = AuditSerializer.many([{ public_id: 'log_public_ghi', metadata: null }]);
    expect(items[0]?.metadata).toBeNull();
  });

  it('returns array metadata unchanged (not object-shaped)', () => {
    const metadata = [{ user_id: 1 }];
    const items = AuditSerializer.many([{ public_id: 'log_public_jkl', metadata }]);
    expect(items[0]?.metadata).toEqual(metadata);
  });
});
