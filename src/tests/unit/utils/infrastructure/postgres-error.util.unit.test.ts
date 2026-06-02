import { describe, expect, it, vi } from 'vitest';
import {
  isPostgresForeignKeyViolation,
  isPostgresUniqueViolation,
  runInsertWithPublicIdentifierRetry,
} from '@/shared/utils/infrastructure/postgres-error.util.js';

describe('postgres-error.util', () => {
  it('detects unique and foreign key violations at the top level', () => {
    expect(isPostgresUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPostgresUniqueViolation({ code: '23503' })).toBe(false);
    expect(isPostgresForeignKeyViolation({ code: '23503' })).toBe(true);
    expect(isPostgresForeignKeyViolation(null)).toBe(false);
  });

  it('unwraps a Drizzle-wrapped PostgresError (code on error.cause)', () => {
    // Drizzle wraps the driver error: the SQLSTATE lives on `.cause`, not the top.
    const wrapped = { query: 'insert ...', cause: { name: 'PostgresError', code: '23505' } };
    expect(isPostgresUniqueViolation(wrapped)).toBe(true);
    const wrappedFk = { query: 'insert ...', cause: { code: '23503' } };
    expect(isPostgresForeignKeyViolation(wrappedFk)).toBe(true);
  });

  it('retries only a public_id unique violation, then succeeds', async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce({ code: '23505', constraint_name: 'idx_users_public_id' })
      .mockResolvedValueOnce('ok');

    const result = await runInsertWithPublicIdentifierRetry(insert, 3);
    expect(result).toBe('ok');
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('retries a public_id collision even when wrapped in error.cause', async () => {
    const insert = vi
      .fn()
      .mockRejectedValueOnce({
        cause: { code: '23505', constraint_name: 'idx_organizations_public_id' },
      })
      .mockResolvedValueOnce('ok');

    const result = await runInsertWithPublicIdentifierRetry(insert, 3);
    expect(result).toBe('ok');
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-public_id unique violation (e.g. slug) — rethrows immediately', async () => {
    // A slug collision cannot be resolved by regenerating a public_id; retrying it
    // would run on the already-aborted transaction (25P02). It must rethrow at once.
    const slugViolation = { code: '23505', constraint_name: 'idx_organizations_slug' };
    const insert = vi.fn().mockRejectedValue(slugViolation);

    await expect(runInsertWithPublicIdentifierRetry(insert, 5)).rejects.toBe(slugViolation);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('throws non-unique errors immediately', async () => {
    await expect(
      runInsertWithPublicIdentifierRetry(async () => {
        throw new Error('other');
      }),
    ).rejects.toThrow('other');
  });
});
