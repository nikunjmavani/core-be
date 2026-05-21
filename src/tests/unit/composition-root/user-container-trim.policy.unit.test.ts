/**
 * Policy: `UserContainer` exports services only; `UserRepository` stays inside the user domain.
 *
 * Backs plan #58 (`p2-user-container-trim`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = join(PROJECT_ROOT, 'src');
const USER_DOMAIN_ROOT = join(SRC_ROOT, 'domains/user');

const SKIP_DIRECTORIES = new Set(['__tests__', 'node_modules']);

function collectSourceFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectSourceFiles(fullPath, accumulator);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      accumulator.push(relative(PROJECT_ROOT, fullPath));
    }
  }
  return accumulator;
}

const OUTSIDE_USER_DOMAIN_FILES = collectSourceFiles(SRC_ROOT).filter(
  (filePath) => !filePath.startsWith('domains/user/'),
);

describe('Policy: UserContainer trims repository from public surface', () => {
  it('UserContainer type exports only services', () => {
    const containerSource = readFileSync(
      join(PROJECT_ROOT, 'src/domains/user/user.container.ts'),
      'utf8',
    );
    const typeBlock = containerSource.match(/export type UserContainer = \{([\s\S]*?)\};/);
    expect(typeBlock).not.toBeNull();
    const typeBody = typeBlock?.[1];
    expect(typeBody).toBeDefined();
    const keys = [...typeBody!.matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);
    expect(keys.sort()).toEqual(
      [
        'userDataExportService',
        'userNotificationPreferencesService',
        'userService',
        'userSettingsService',
      ].sort(),
    );
    expect(keys).not.toContain('userRepository');
  });

  it('no module outside src/domains/user imports user.repository', () => {
    const importPattern =
      /from\s+['"]@\/domains\/user\/user\.repository(?:\.js)?['"]|from\s+['"]\.\.\/.*user\.repository(?:\.js)?['"]/;
    const offenders: string[] = [];
    for (const filePath of OUTSIDE_USER_DOMAIN_FILES) {
      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      if (importPattern.test(source)) {
        offenders.push(filePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('user sub-domain services do not import user.repository directly', () => {
    const serviceFiles = collectSourceFiles(join(USER_DOMAIN_ROOT, 'sub-domains')).filter((path) =>
      path.endsWith('.service.ts'),
    );
    const offenders: string[] = [];
    for (const filePath of serviceFiles) {
      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      if (/user\.repository/.test(source)) {
        offenders.push(filePath);
      }
    }
    expect(offenders).toEqual([]);
  });
});
