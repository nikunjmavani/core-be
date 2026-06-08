import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * sec-r4-D4 regression — `findByRoleId` must apply a hard row cap so a
 * corrupted `tenancy.role_permissions` table cannot page unbounded rows into
 * the API process on every per-role permission read.
 *
 * This is a policy test on the repository source: seeding 257 permission rows
 * requires bootstrapping the full system permission registry (each
 * `role_permissions.permission_code` is a FK to `tenancy.permissions`), which
 * is heavier than the invariant being asserted. Reading the source ensures
 * the next reviewer of this file cannot silently drop the cap.
 */
describe('member-role-permission repository row cap policy (sec-r4-D4)', () => {
  const repositoryPath = join(
    process.cwd(),
    'src/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.repository.ts',
  );
  const source = readFileSync(repositoryPath, 'utf8');

  it('defines a module-level MEMBER_ROLE_PERMISSION_MAX_ROWS_PER_ROLE constant', () => {
    expect(source).toMatch(/const\s+MEMBER_ROLE_PERMISSION_MAX_ROWS_PER_ROLE\s*=\s*\d+\s*;/);
  });

  it('caps the constant at no more than 1024 rows (catalog is ~50 codes today)', () => {
    const match = source.match(/const\s+MEMBER_ROLE_PERMISSION_MAX_ROWS_PER_ROLE\s*=\s*(\d+)\s*;/);
    expect(match).not.toBeNull();
    const limit = Number.parseInt(match?.[1] ?? '0', 10);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(1024);
  });

  it('findByRoleId applies .limit(MEMBER_ROLE_PERMISSION_MAX_ROWS_PER_ROLE)', () => {
    // Match across optional whitespace / line breaks inside the method body.
    expect(source).toMatch(
      /findByRoleId\([\s\S]*?\.limit\(MEMBER_ROLE_PERMISSION_MAX_ROWS_PER_ROLE\)/,
    );
  });
});
