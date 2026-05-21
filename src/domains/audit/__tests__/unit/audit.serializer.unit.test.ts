import { describe, expect, it } from 'vitest';
import { AuditSerializer } from '@/domains/audit/audit.serializer.js';

describe('AuditSerializer', () => {
  it('many returns items unchanged (pass-through)', () => {
    const logs = [
      { id: '1', action: 'created', metadata: {} },
      { id: '2', action: 'updated', metadata: {} },
    ];
    expect(AuditSerializer.many(logs)).toEqual(logs);
  });
});
