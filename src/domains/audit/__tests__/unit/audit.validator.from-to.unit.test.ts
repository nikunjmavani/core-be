import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateListAuditLogsQuery } from '@/domains/audit/audit.validator.js';

describe('audit.validator from/to range (regression-guard)', () => {
  const sameInstant = '2026-03-01T12:00:00.000Z';

  it('validateListAuditLogsQuery accepts from === to (same instant boundary)', () => {
    const result = validateListAuditLogsQuery({ from: sameInstant, to: sameInstant });
    expect(result.from).toBe(sameInstant);
    expect(result.to).toBe(sameInstant);
  });

  it('validateListAuditLogsQuery accepts from > to (temporal ordering not enforced today)', () => {
    const result = validateListAuditLogsQuery({
      from: '2026-03-02T00:00:00.000Z',
      to: '2026-03-01T00:00:00.000Z',
    });
    expect(result.from).toBe('2026-03-02T00:00:00.000Z');
    expect(result.to).toBe('2026-03-01T00:00:00.000Z');
  });

  it('validateListAuditLogsQuery rejects malformed ISO strings on from or to (date-only / empty)', () => {
    expect(() => validateListAuditLogsQuery({ from: '2026-03-01' })).toThrow(ValidationError);
    expect(() => validateListAuditLogsQuery({ to: '' })).toThrow(ValidationError);
  });
});
