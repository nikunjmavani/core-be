import { describe, it, expect } from 'vitest';
import { AuditSerializer } from '@/domains/audit/audit.serializer.js';

describe('AuditSerializer — metadata identifier stripping', () => {
  it('strips keys ending with _id from metadata objects', () => {
    const items = AuditSerializer.many([
      {
        public_id: 'log_public_abc',
        metadata: {
          user_id: 99,
          organization_id: 42,
          action_detail: 'role changed',
        },
      },
    ]);

    expect(items[0]?.metadata).toEqual({ action_detail: 'role changed' });
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
