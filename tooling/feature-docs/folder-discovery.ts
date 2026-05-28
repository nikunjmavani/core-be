/**
 * Walks `src/` and produces the list of directories that should carry a
 * `DOCS.md`. A folder is "documented" when it contains at least one
 * non-test TypeScript source file directly inside it. Test scaffolding
 * (`__tests__/`, factories, fixtures, helpers) is intentionally skipped —
 * test suites under `src/tests/<suite>/` are documented via Template A.4.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  ALLOWED_TYPESCRIPT_EXTENSIONS,
  CORE_ROOT,
  DOMAINS_ROOT,
  FOLDER_NAMES_TO_SKIP,
  INFRASTRUCTURE_ROOT,
  REPO_ROOT,
  SCRIPTS_ROOT,
  SHARED_ROOT,
  SRC_ROOT,
  TEST_FILE_SUFFIXES,
  TESTS_ROOT,
} from './constants.js';
import type { FolderRole, OverviewVariant } from './types.js';

interface DiscoveredFolder {
  absolutePath: string;
  relativePath: string;
  pathLabel: string;
  role: FolderRole;
  overviewVariant: OverviewVariant | null;
  overviewExpected: boolean;
  parentAbsolutePath: string | null;
  typeScriptFiles: string[];
}

function isTestFile(fileName: string): boolean {
  return TEST_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

function listImmediateChildren(absolutePath: string): { directories: string[]; files: string[] } {
  const directories: string[] = [];
  const files: string[] = [];
  const entries = readdirSync(absolutePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (FOLDER_NAMES_TO_SKIP.has(entry.name)) continue;
      directories.push(join(absolutePath, entry.name));
      continue;
    }
    if (entry.isFile()) {
      files.push(join(absolutePath, entry.name));
    }
  }
  return { directories, files };
}

function listDocumentableTypeScriptFiles(filePaths: string[]): string[] {
  const documentable: string[] = [];
  for (const filePath of filePaths) {
    const baseName = filePath.split(sep).pop() ?? '';
    const matchesExtension = ALLOWED_TYPESCRIPT_EXTENSIONS.some((extension) =>
      baseName.endsWith(extension),
    );
    if (!matchesExtension) continue;
    if (baseName.endsWith('.d.ts')) continue;
    if (isTestFile(baseName)) continue;
    documentable.push(filePath);
  }
  return documentable;
}

function classifyFolderRole(absolutePath: string): FolderRole {
  const relativePath = relative(SRC_ROOT, absolutePath).split(sep).join('/');

  if (relativePath === '') return 'system-root';

  if (absolutePath.startsWith(`${DOMAINS_ROOT}${sep}`) || absolutePath === DOMAINS_ROOT) {
    const segments = relative(DOMAINS_ROOT, absolutePath).split(sep);
    if (segments.length === 1 && segments[0] !== '') return 'domain';
    if (segments.length === 3 && segments[1] === 'sub-domains') return 'sub-domain';
    if (segments.length === 5 && segments[1] === 'sub-domains' && segments[3] === 'sub-domains') {
      return 'nested-sub-domain';
    }
    if (segments.length >= 4 && segments[1] === 'sub-domains') {
      return 'sub-domain';
    }
  }

  if (absolutePath.startsWith(`${INFRASTRUCTURE_ROOT}${sep}`)) {
    return 'infrastructure-module';
  }

  if (absolutePath.startsWith(`${SHARED_ROOT}${sep}`)) {
    return 'shared-module';
  }

  if (absolutePath.startsWith(`${SCRIPTS_ROOT}${sep}`)) {
    return 'scripts-area';
  }

  if (absolutePath.startsWith(`${CORE_ROOT}${sep}`)) {
    return 'core-area';
  }

  if (absolutePath.startsWith(`${TESTS_ROOT}${sep}`) || absolutePath === TESTS_ROOT) {
    const segments = relative(TESTS_ROOT, absolutePath).split(sep);
    if (segments.length === 1 && segments[0] !== '') return 'tests-suite';
  }

  return 'generic';
}

function pickOverviewVariant(role: FolderRole): OverviewVariant | null {
  if (role === 'domain') return 'A.1-domain';
  if (role === 'sub-domain' || role === 'nested-sub-domain') return 'A.2-sub-domain';
  if (role === 'infrastructure-module' || role === 'shared-module') return 'A.3-infra-shared';
  if (role === 'tests-suite') return 'A.4-test-suite';
  return null;
}

function isOverviewExpected(role: FolderRole): boolean {
  return (
    role === 'domain' ||
    role === 'sub-domain' ||
    role === 'nested-sub-domain' ||
    role === 'tests-suite'
  );
}

function isFolderDocumentable(role: FolderRole, typeScriptFiles: string[]): boolean {
  if (role === 'system-root') return false;
  if (role === 'tests-suite') return true;
  return (
    typeScriptFiles.length > 0 ||
    role === 'domain' ||
    role === 'sub-domain' ||
    role === 'nested-sub-domain'
  );
}

export function discoverDocumentedFolders(): DiscoveredFolder[] {
  const visited = new Set<string>();
  const stack: string[] = [SRC_ROOT];
  const documented: DiscoveredFolder[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (!statSync(current).isDirectory()) continue;

    const { directories, files } = listImmediateChildren(current);
    for (const directory of directories) {
      stack.push(directory);
    }

    if (current === SRC_ROOT) continue;

    const role = classifyFolderRole(current);
    const typeScriptFiles = listDocumentableTypeScriptFiles(files);
    if (!isFolderDocumentable(role, typeScriptFiles)) continue;

    const relativePath = relative(REPO_ROOT, current).split(sep).join('/');
    documented.push({
      absolutePath: current,
      relativePath,
      pathLabel: `${relativePath}/`,
      role,
      overviewVariant: pickOverviewVariant(role),
      overviewExpected: isOverviewExpected(role),
      parentAbsolutePath: parentDirectoryAbsolutePath(current),
      typeScriptFiles,
    });
  }

  documented.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return documented;
}

function parentDirectoryAbsolutePath(absolutePath: string): string | null {
  if (absolutePath === SRC_ROOT) return null;
  const segments = absolutePath.split(sep);
  segments.pop();
  return segments.join(sep);
}
