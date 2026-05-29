import { describe, it, expect } from 'vitest';
import { parseMigrationExecutionMode } from '@/infrastructure/database/migration/migration-execution-mode.js';

describe('parseMigrationExecutionMode', () => {
  it('defaults to transactional when no header is present', () => {
    const result = parseMigrationExecutionMode(
      'CREATE TABLE IF NOT EXISTS public.foo (id BIGINT);\n',
    );
    expect(result.transactional).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.headerErrors).toEqual([]);
  });

  it('marks a migration non-transactional with a reason', () => {
    const sql = `-- migration-transaction: none reason="CREATE INDEX CONCURRENTLY cannot run in a transaction"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_foo_bar ON public.foo (bar);
`;
    const result = parseMigrationExecutionMode(sql);
    expect(result.transactional).toBe(false);
    expect(result.reason).toBe('CREATE INDEX CONCURRENTLY cannot run in a transaction');
    expect(result.headerErrors).toEqual([]);
  });

  it('rejects a bare migration-transaction comment', () => {
    const result = parseMigrationExecutionMode('-- migration-transaction:\n');
    expect(result.transactional).toBe(true);
    expect(result.headerErrors).toHaveLength(1);
    expect(result.headerErrors[0]).toContain('bare');
  });

  it('rejects an unknown mode', () => {
    const result = parseMigrationExecutionMode('-- migration-transaction: maybe reason="hmm"\n');
    expect(result.transactional).toBe(true);
    expect(result.headerErrors).toHaveLength(1);
    expect(result.headerErrors[0]).toContain('unknown migration-transaction mode');
  });

  it('rejects a malformed header missing the reason field', () => {
    const result = parseMigrationExecutionMode('-- migration-transaction: none\n');
    expect(result.transactional).toBe(true);
    expect(result.headerErrors).toHaveLength(1);
    expect(result.headerErrors[0]).toContain('valid migration-transaction header');
  });

  it('rejects an empty reason', () => {
    const result = parseMigrationExecutionMode('-- migration-transaction: none reason=""\n');
    expect(result.transactional).toBe(true);
    expect(result.headerErrors).toHaveLength(1);
    expect(result.headerErrors[0]).toContain('non-empty reason');
  });

  it('ignores the header when it appears after the first 20 lines', () => {
    const padding = Array.from({ length: 21 }, () => '-- filler').join('\n');
    const sql = `${padding}\n-- migration-transaction: none reason="too late"\n`;
    const result = parseMigrationExecutionMode(sql);
    expect(result.transactional).toBe(true);
    expect(result.headerErrors).toEqual([]);
  });
});
