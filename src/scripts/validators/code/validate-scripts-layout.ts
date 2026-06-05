/**
 * CI gate: every TypeScript script must live under a category folder, not src/scripts/*.ts root.
 * Usage: pnpm validate:scripts-layout
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SCRIPTS_ROOT = resolve(process.cwd(), 'src/scripts');

const ALLOWED_CATEGORY_DIRECTORIES = new Set([
  'admin',
  'codegen',
  'ops',
  'seed',
  'tooling',
  'validators',
]);

function collectRootTypeScriptFiles(): string[] {
  const entries = readdirSync(SCRIPTS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(SCRIPTS_ROOT, entry.name));
}

function main(): void {
  const rootFiles = collectRootTypeScriptFiles();

  if (rootFiles.length > 0) {
    console.error('src/scripts/*.ts must be empty — move scripts into a category folder:\n');
    for (const filePath of rootFiles.sort((a, b) => a.localeCompare(b))) {
      console.error(`  ${filePath.replace(`${process.cwd()}/`, '')}`);
    }
    console.error(
      `\nAllowed categories: ${[...ALLOWED_CATEGORY_DIRECTORIES].sort((a, b) => a.localeCompare(b)).join(', ')}`,
    );
    console.error('See docs/reference/architecture/scripts-layout.md');
    process.exit(1);
  }

  const topLevel = readdirSync(SCRIPTS_ROOT, { withFileTypes: true });
  const unexpectedDirectories = topLevel
    .filter((entry) => entry.isDirectory() && !ALLOWED_CATEGORY_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name);

  if (unexpectedDirectories.length > 0) {
    console.error('Unexpected directories under src/scripts/:');
    for (const name of unexpectedDirectories.sort((a, b) => a.localeCompare(b))) {
      console.error(`  src/scripts/${name}/`);
    }
    process.exit(1);
  }

  console.log('scripts layout OK — no TypeScript files at src/scripts/ root');
}

main();
