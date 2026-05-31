/**
 * Generates docs/reference/architecture/src-structure-tree.txt from src/.
 * Run: pnpm tool:project-structure-tree
 * Check: pnpm tool:project-structure-tree:check
 * Stdout (legacy, skips __tests__): pnpm tool:project-structure-tree --stdout
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  SKIP_DIRS_STDOUT,
  SKIP_DIRS_WRITE,
  SKIP_FILE_NAMES,
  SRC_ROOT,
  SRC_STRUCTURE_TREE_OUTPUT_PATH,
  STRUCTURE_TREE_HEADER,
} from '@/scripts/codegen/project-structure-tree.constants.js';

/** Options controlling whether `__tests__` directories appear in the tree output. */
export interface BuildSrcStructureTreeOptions {
  includeTests: boolean;
}

function shouldSkipEntry(options: { name: string; skipDirectories: Set<string> }): boolean {
  const { name, skipDirectories } = options;
  if (SKIP_FILE_NAMES.has(name)) return true;
  if (name.startsWith('.') && name !== '.gitkeep') return true;
  return skipDirectories.has(name);
}

function appendTreeLines(options: {
  directoryPath: string;
  sourceRoot: string;
  prefix: string;
  isLast: boolean;
  skipDirectories: Set<string>;
  lines: string[];
}): void {
  const { directoryPath, sourceRoot, prefix, isLast, skipDirectories, lines } = options;
  const entries = readdirSync(directoryPath)
    .filter((name) => !shouldSkipEntry({ name, skipDirectories }))
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
      lines.push(`${prefix}${connector}${name}/`);
      appendTreeLines({
        directoryPath: entryPath,
        sourceRoot,
        prefix: childPrefix,
        isLast: entryLast,
        skipDirectories,
        lines,
      });
      continue;
    }

    lines.push(`${prefix}${connector}${name}`);
  }
}

/** Builds an ASCII directory tree for `src/` using the committed or stdout walk rules. */
export function buildSrcStructureTree(options: BuildSrcStructureTreeOptions): string {
  const sourceRoot = join(process.cwd(), SRC_ROOT);
  if (!existsSync(sourceRoot)) {
    throw new Error(`Missing ${SRC_ROOT}/ directory`);
  }

  const skipDirectories = options.includeTests ? SKIP_DIRS_WRITE : SKIP_DIRS_STDOUT;
  const lines: string[] = [];
  lines.push(`${SRC_ROOT}/`);
  appendTreeLines({
    directoryPath: sourceRoot,
    sourceRoot,
    prefix: '',
    isLast: true,
    skipDirectories,
    lines,
  });

  const skipped = options.includeTests
    ? [...SKIP_DIRS_WRITE].join(', ')
    : [...SKIP_DIRS_STDOUT].join(', ');

  lines.push('');
  lines.push(`# Skipped directories: ${skipped}/, ${[...SKIP_FILE_NAMES].join(', ')}`);
  lines.push(
    '# Canonical layout: CLAUDE.md, docs/reference/architecture/domains-and-public-api-design.md',
  );

  if (options.includeTests) {
    return `${STRUCTURE_TREE_HEADER}${lines.join('\n')}\n`;
  }

  return `${lines.join('\n')}\n`;
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const stdoutOnly = process.argv.includes('--stdout');
  const includeTests = !stdoutOnly;
  const treeContent = buildSrcStructureTree({ includeTests });

  if (checkOnly) {
    const existingContent = readFileSync(SRC_STRUCTURE_TREE_OUTPUT_PATH, 'utf-8');
    if (existingContent !== treeContent) {
      console.error(
        `Source structure tree out of sync (${SRC_STRUCTURE_TREE_OUTPUT_PATH}). Run pnpm tool:project-structure-tree and commit.`,
      );
      process.exit(1);
    }
    console.log(`${SRC_STRUCTURE_TREE_OUTPUT_PATH} is in sync with ${SRC_ROOT}/.`);
    return;
  }

  if (stdoutOnly) {
    process.stdout.write(treeContent);
    return;
  }

  mkdirSync(dirname(SRC_STRUCTURE_TREE_OUTPUT_PATH), { recursive: true });
  writeFileSync(SRC_STRUCTURE_TREE_OUTPUT_PATH, treeContent, 'utf-8');
  const lineCount = treeContent.split('\n').length;
  console.log(`Wrote ${lineCount} lines to ${SRC_STRUCTURE_TREE_OUTPUT_PATH}`);
}

main();
