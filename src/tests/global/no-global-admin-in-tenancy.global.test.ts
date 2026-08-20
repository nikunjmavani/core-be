import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the invariant behind PRs #1105 / #1106: **tenancy code must never reach for the
 * global-admin escape hatch.**
 *
 * `tenancy.organizations` and `tenancy.memberships` are FORCE RLS, and their policies honor only
 * `app.current_organization_id` (`organizations_tenant_isolation`) and `app.current_user_id`
 * (`organizations_user_discovery` / `memberships_user_self_discovery`). Unlike the `auth.*` and
 * `audit.logs` policies, **none of them carries an `app.global_admin` arm** — so
 * `withGlobalAdminDatabaseContext` grants exactly nothing on tenancy tables while looking like it
 * grants everything.
 *
 * That mismatch shipped three times:
 * - `provisionOrganization` — the org INSERT failed its WITH CHECK with SQLSTATE 42501.
 * - `resolve-active-organization` — every active-org read returned zero rows, so users logged in
 *   with no `org` claim, no permissions, and a "you don't have permission" dashboard.
 * - `OrganizationRepository`'s user-id resolvers — silently returned `null`, skipping the
 *   permission-cache purge on role change and nulling `created_by_user_id` attribution.
 *
 * Each was invisible locally and in CI, because `docker-compose.yml` and every workflow connect as
 * `POSTGRES_USER: core` — a container superuser that bypasses RLS wholesale. A static guard is
 * therefore the only cheap defence.
 *
 * Comment mentions are allowed (both surviving references explain why the hatch is NOT used);
 * only a real import is a violation.
 */
describe('Global: tenancy code never uses the global-admin RLS escape hatch', () => {
  const SKIP_DIRECTORIES = new Set<string>(['__tests__', '__snapshots__', 'node_modules', 'dist']);

  /**
   * Matches an actual import of the hatch, not prose. Both a named import and a namespace/default
   * import of the context module count; a `withGlobalAdminDatabaseContext` mention inside a `//` or
   * `/** *\/` comment does not.
   */
  const GLOBAL_ADMIN_IMPORT =
    /^\s*import\s[\s\S]*?from\s+['"][^'"]*global-admin-database\.context\.js['"]/gm;

  async function* walkTypeScriptFiles(root: string): AsyncGenerator<string> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(root, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        yield* walkTypeScriptFiles(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) continue;
      yield entryPath;
    }
  }

  it('no file under src/domains/tenancy imports withGlobalAdminDatabaseContext', async () => {
    const repositoryRoot = process.cwd();
    const tenancyRoot = join(repositoryRoot, 'src', 'domains', 'tenancy');

    const violations: string[] = [];
    for await (const filePath of walkTypeScriptFiles(tenancyRoot)) {
      const source = await fs.readFile(filePath, 'utf8');
      GLOBAL_ADMIN_IMPORT.lastIndex = 0;
      if (GLOBAL_ADMIN_IMPORT.test(source)) {
        violations.push(relative(repositoryRoot, filePath));
      }
    }

    expect(
      violations,
      'Tenancy RLS policies do not honor app.global_admin — the hatch reads/writes ZERO rows there.\n' +
        'Use withUserDatabaseContext (app.current_user_id), withOrganizationDatabaseContext\n' +
        '(app.current_organization_id), or an auth.* SECURITY DEFINER resolver instead.\n' +
        `Offending file(s):\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });
});
