/**
 * Policy: TypeScript under src/ and tooling/ must use path aliases (@/, @tooling/)
 * or same-folder relative imports (./). Parent-relative imports (../) are forbidden.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'tooling'] as const;

const PARENT_RELATIVE_IMPORT_PATTERN =
  /(?:from\s+['"]|\bimport\s*\(['"])(\.\.(?:\/|$)[^'"]*)(['"])/;

const SCAN_SKIP_PATH_SEGMENTS = ['node_modules', 'dist'] as const;

function collectTypeScriptFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const relativePath = relative(PROJECT_ROOT, fullPath);
    if (SCAN_SKIP_PATH_SEGMENTS.some((segment) => relativePath.split('/').includes(segment))) {
      continue;
    }
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectTypeScriptFiles(fullPath, files);
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(relativePath);
    }
  }
  return files;
}

function findParentRelativeImports(source: string): string[] {
  const offenders: string[] = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    const match = PARENT_RELATIVE_IMPORT_PATTERN.exec(line);
    if (match?.[1]?.startsWith('../')) {
      offenders.push(trimmed);
    }
  }
  return offenders;
}

describe('Policy: strict import paths', () => {
  const sourceFiles = SCAN_ROOTS.flatMap((root) =>
    collectTypeScriptFiles(join(PROJECT_ROOT, root)),
  );

  it('no src/ or tooling/ TypeScript file uses parent-relative imports (../)', () => {
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      const offenders = findParentRelativeImports(source);
      if (offenders.length > 0) {
        violations.push(`${filePath}:\n  ${offenders.join('\n  ')}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
