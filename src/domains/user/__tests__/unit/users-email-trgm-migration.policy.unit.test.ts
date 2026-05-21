import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migrations were consolidated into `00000000000000_init.sql`. The policy still asserts that the
 * resulting init migration declares `pg_trgm` and the GIN trigram index on auth.users.email so the
 * lookup remains fast (see explain-analyze tests and `idx_users_email_trgm` usage).
 */
const migrationPath = join(process.cwd(), 'migrations/00000000000000_init.sql');

describe('users email pg_trgm migration policy', () => {
  it('defines pg_trgm extension and GIN index on auth.users.email', () => {
    const source = readFileSync(migrationPath, 'utf8');
    expect(source).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(source).toContain('idx_users_email_trgm');
    expect(source.toLowerCase()).toContain('using gin');
    expect(source).toContain('gin_trgm_ops');
  });
});
