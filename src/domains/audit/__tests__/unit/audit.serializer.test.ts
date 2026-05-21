import { describe, expect, it } from 'vitest';
import { AuditSerializer } from '@/domains/audit/audit.serializer.js';

describe('AuditSerializer', () => {
  it('many sanitizes metadata identifiers', () => {
    const logs = [
      { id: '1', action: 'created', metadata: { source: 'test', auth_method_id: 99 } },
      { id: '2', action: 'updated' },
    ];
    expect(AuditSerializer.many(logs)).toEqual([
      { id: '1', action: 'created', metadata: { source: 'test' } },
      { id: '2', action: 'updated', metadata: undefined },
    ]);
  });
});
