import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: the `core_be_app` least-privilege migration must stay Neon-safe.
 *
 * `ALTER ROLE ... NOSUPERUSER / NOBYPASSRLS / NOREPLICATION` requires the **SUPERUSER** attribute to
 * execute — even when setting a role to attribute values it already has. On managed Postgres (Neon,
 * RDS) the migration role is not a superuser, so a bare `ALTER ROLE` fails with SQLSTATE 42501
 * (`insufficient_privilege`) and aborts the migrate step — blocking every deploy. It worked only on
 * local Docker Postgres, which runs as the `postgres` superuser.
 *
 * The statement must therefore stay wrapped in a `DO $$ … EXCEPTION WHEN insufficient_privilege …`
 * block, so it pins the attributes where the executing role is permitted and is a safe no-op on
 * managed Postgres (where the `NOLOGIN` defaults already hold). This test fails if anyone
 * "simplifies" it back to a bare `ALTER ROLE`.
 */
const migrationPath = join(
  process.cwd(),
  'migrations/20260603150000_core_be_app_role_least_privilege.sql',
);

describe('core_be_app least-privilege migration is Neon-safe', () => {
  const migrationSql = readFileSync(migrationPath, 'utf8');

  it('still pins the least-privilege attributes on core_be_app', () => {
    expect(migrationSql).toMatch(/ALTER ROLE core_be_app[\s\S]*NOSUPERUSER[\s\S]*NOBYPASSRLS/);
  });

  it('wraps the ALTER in an insufficient_privilege-safe DO block (managed Postgres has no superuser)', () => {
    expect(migrationSql).toContain('DO $$');
    expect(migrationSql).toMatch(/EXCEPTION\s+WHEN\s+insufficient_privilege/);
  });
});
