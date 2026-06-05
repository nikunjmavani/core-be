/**
 * One-off codemod: rewrite parent-relative imports (`../`) to `@/` or `@tooling/` aliases.
 * Same-folder `./` imports are left unchanged.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const PROJECT_ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'tooling'] as const;

function collectTypeScriptFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (entry === 'node_modules' || entry === 'dist') continue;
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectTypeScriptFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveToAlias(filePath: string, importPath: string): string {
  const fileDirectory = dirname(filePath);
  const absoluteTarget = normalize(resolve(fileDirectory, importPath));
  const relativeToRoot = relative(PROJECT_ROOT, absoluteTarget);

  if (relativeToRoot.startsWith('src/')) {
    return `@/${relativeToRoot.slice(4)}`;
  }
  if (relativeToRoot.startsWith('tooling/')) {
    return `@tooling/${relativeToRoot.slice('tooling/'.length)}`;
  }

  throw new Error(`Cannot alias import in ${filePath}: ${importPath} → ${relativeToRoot}`);
}

function rewriteFile(filePath: string): boolean {
  const source = readFileSync(filePath, 'utf8');
  let changed = false;

  const updated = source.replace(
    /(?:from\s+['"]|\bimport\s*\(['"])(\.(?:\.\/)+[^'"]+)(?:['"])/g,
    (match, importPath: string) => {
      if (!importPath.startsWith('../')) {
        return match;
      }
      const alias = resolveToAlias(filePath, importPath);
      changed = true;
      return match.replace(importPath, alias);
    },
  );

  if (changed) {
    writeFileSync(filePath, updated, 'utf8');
  }
  return changed;
}

function main(): void {
  const changedFiles: string[] = [];

  for (const root of SCAN_ROOTS) {
    const rootPath = join(PROJECT_ROOT, root);
    for (const filePath of collectTypeScriptFiles(rootPath)) {
      if (rewriteFile(filePath)) {
        changedFiles.push(relative(PROJECT_ROOT, filePath));
      }
    }
  }

  console.log(`Rewrote ${changedFiles.length} file(s):`);
  for (const file of changedFiles.sort((a, b) => a.localeCompare(b))) {
    console.log(`  ${file}`);
  }
}

main();
