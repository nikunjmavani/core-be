import { describe, expect, it } from 'vitest';
import { describeMigrationConnectionError } from '@/infrastructure/database/migration/migration-error-hint.js';

describe('describeMigrationConnectionError', () => {
  it('explains password auth failure (28P01) with the placeholder + encoding hints', () => {
    const hint = describeMigrationConnectionError({ code: '28P01' });
    expect(hint).toMatch(/28P01/);
    expect(hint).toMatch(/password/i);
    expect(hint).toMatch(/placeholder/i);
  });

  it('explains an unreachable host for connect / timeout / DNS codes', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'CONNECT_TIMEOUT']) {
      expect(describeMigrationConnectionError({ code })).toMatch(
        /reach the database host|non-pooler/i,
      );
    }
  });

  it('explains a missing database (3D000)', () => {
    expect(describeMigrationConnectionError({ code: '3D000' })).toMatch(/database does not exist/i);
  });

  it('reads the code from a nested cause chain', () => {
    const wrapped = new Error('connect failed', { cause: { code: '28P01' } });
    expect(describeMigrationConnectionError(wrapped)).toMatch(/28P01/);
  });

  it('returns null for unknown errors and never leaks a connection string', () => {
    expect(describeMigrationConnectionError({ code: 'XX999' })).toBeNull();
    expect(describeMigrationConnectionError(new Error('boom'))).toBeNull();
    expect(describeMigrationConnectionError(undefined)).toBeNull();
    expect(describeMigrationConnectionError({ code: '28P01' })).not.toMatch(/postgres(ql)?:\/\//);
  });
});
