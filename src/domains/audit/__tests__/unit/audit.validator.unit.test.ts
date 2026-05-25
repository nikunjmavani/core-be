import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY } from '@/shared/utils/http/pagination.util.js';
import { validateListAuditLogsQuery } from '@/domains/audit/audit.validator.js';

describe('audit.validator', () => {
  it('validateListAuditLogsQuery applies pagination defaults', () => {
    expect(validateListAuditLogsQuery({})).toMatchObject({ limit: 25 });
  });

  it('validateListAuditLogsQuery accepts filter fields', () => {
    const result = validateListAuditLogsQuery({
      resource_type: 'user',
      action: 'created',
      from: '2026-01-01T00:00:00.000Z',
    });
    expect(result.resource_type).toBe('user');
    expect(result.action).toBe('created');
  });

  it('validateListAuditLogsQuery rejects invalid datetime', () => {
    expect(() => validateListAuditLogsQuery({ from: 'not-a-date' })).toThrow(ValidationError);
  });

  it('validateListAuditLogsQuery rejects invalid to datetime', () => {
    expect(() => validateListAuditLogsQuery({ to: '2026-13-40' })).toThrow(ValidationError);
  });

  it('validateListAuditLogsQuery rejects legacy page query parameter', () => {
    try {
      validateListAuditLogsQuery({ page: '1', limit: '20' });
      expect.fail('expected ValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).messageKey).toBe(LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY);
    }
  });
});
