import { describe, expect, it, vi } from 'vitest';
import {
  isPostgresForeignKeyViolation,
  isPostgresUniqueViolation,
  runInsertWithPublicIdentifierRetry,
} from '@/shared/utils/infrastructure/postgres-error.util.js';

describe('postgres-error.util', () => {
  it('detects unique and foreign key violations', () => {
    expect(isPostgresUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPostgresUniqueViolation({ code: '23503' })).toBe(false);
    expect(isPostgresForeignKeyViolation({ code: '23503' })).toBe(true);
    expect(isPostgresForeignKeyViolation(null)).toBe(false);
  });

  it('retries insert on unique violation then succeeds', async () => {
    const insert = vi.fn().mockRejectedValueOnce({ code: '23505' }).mockResolvedValueOnce('ok');

    const result = await runInsertWithPublicIdentifierRetry(insert, 3);
    expect(result).toBe('ok');
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('throws non-unique errors immediately', async () => {
    await expect(
      runInsertWithPublicIdentifierRetry(async () => {
        throw new Error('other');
      }),
    ).rejects.toThrow('other');
  });
});
