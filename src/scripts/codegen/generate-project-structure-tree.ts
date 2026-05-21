/**
 * Prints an indented tree of src/ for local exploration (stdout).
 * Run: pnpm tool:project-structure-tree
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SOURCE_ROOT = join(process.cwd(), 'src');

const SKIP_DIRECTORY_NAMES = new Set(['__tests__', 'node_modules', '.vite', 'dist', 'coverage']);

const SKIP_FILE_NAMES = new Set(['.gitkeep']);

function shouldSkipEntry(name: string, directoryPath: string): boolean {
  if (SKIP_FILE_NAMES.has(name)) {
    return true;
  }
  if (name.startsWith('.') && name !== '.gitkeep') {
    return true;
  }
  const relativePath = relative(SOURCE_ROOT, directoryPath);
  if (relativePath.startsWith('tests') && name === 'node_modules') {
    return true;
  }
  return false;
}

function printTree(directoryPath: string, prefix: string, isLast: boolean): void {
  const entries = readdirSync(directoryPath)
    .filter((name) => !shouldSkipEntry(name, directoryPath))
    .sort((left, right) => {
      const leftPath = join(directoryPath, left);
      const rightPath = join(directoryPath, right);
      const leftDirectory = statSync(leftPath).isDirectory();
      const rightDirectory = statSync(rightPath).isDirectory();
      if (leftDirectory !== rightDirectory) {
        return leftDirectory ? -1 : 1;
      }
      return left.localeCompare(right);
    });

  for (let index = 0; index < entries.length; index += 1) {
    const name = entries[index]!;
    const entryPath = join(directoryPath, name);
    const entryLast = index === entries.length - 1;
    const connector = entryLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      if (SKIP_DIRECTORY_NAMES.has(name)) {
        continue;
      }
      console.log(`${prefix}${connector}${name}/`);
      printTree(entryPath, childPrefix, entryLast);
    } else {
      const annotation = '';
      console.log(`${prefix}${connector}${name}${annotation}`);
    }
  }
}

function main(): void {
  console.log('src/');
  printTree(SOURCE_ROOT, '', true);
  console.log('\n# Skipped: __tests__/, node_modules/, .vite/, dist/, coverage/, .gitkeep');
  console.log(
    '# Canonical layout: CLAUDE.md, docs/reference/architecture/domains-and-public-api-design.md',
  );
  console.log('# Routes: pnpm routes:catalog → docs/routes.txt');
}

main();
