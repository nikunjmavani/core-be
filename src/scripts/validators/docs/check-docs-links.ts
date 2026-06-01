/**
 * Validates hand-written docs: stale path patterns and broken relative markdown links.
 * Usage: pnpm docs:links:check
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(process.cwd());

/** Known obsolete paths (substring match). */
const STALE_PATTERNS: { pattern: string; suggestion: string }[] = [
  { pattern: 'docs/LOAD-TESTING.md', suggestion: 'docs/reference/testing/load-testing.md' },
  { pattern: 'docs/API-TESTING.md', suggestion: 'docs/getting-started/api-testing.md' },
  {
    pattern: 'docs/PROJECT-STRUCTURE.md',
    suggestion: 'docs/reference/architecture/project-structure-guide.md',
  },
];

const SCAN_ROOTS = [
  join(REPO_ROOT, 'docs'),
  join(REPO_ROOT, 'README.md'),
  join(REPO_ROOT, 'CLAUDE.md'),
  join(REPO_ROOT, 'AGENTS.md'),
  join(REPO_ROOT, 'CONTRIBUTING.md'),
  join(REPO_ROOT, '.cursor/skills'),
  join(REPO_ROOT, '.cursor/rules'),
  join(REPO_ROOT, '.github'),
  join(REPO_ROOT, 'src/tests/load/k6/README.md'),
];

const SKIP_DIR_NAMES = new Set(['openapi', 'node_modules', '.git']);

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;

function collectMarkdownFiles(path: string, out: string[]): void {
  if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
    if (path.endsWith('.md') || path.endsWith('.mdc')) out.push(path);
    return;
  }
  for (const entry of readdirSync(path)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const full = join(path, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectMarkdownFiles(full, out);
    else if (entry.endsWith('.md') || entry.endsWith('.mdc')) out.push(full);
  }
}

function isExternalOrAnchor(target: string): boolean {
  const trimmed = target.trim();
  if (!trimmed || trimmed.startsWith('#')) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
  return false;
}

function resolveMarkdownTarget(fromFile: string, target: string): string {
  const withoutAnchor = target.split('#')[0]?.trim() ?? '';
  if (!withoutAnchor) return fromFile;
  const base = dirname(fromFile);
  return resolve(base, withoutAnchor);
}

function main(): void {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    try {
      collectMarkdownFiles(root, files);
    } catch {
      // optional path missing
    }
  }

  const staleHits: string[] = [];
  const brokenLinks: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const relativeFile = relativePath(file);

    for (const { pattern, suggestion } of STALE_PATTERNS) {
      if (content.includes(pattern)) {
        staleHits.push(`${relativeFile}: stale reference "${pattern}" → use ${suggestion}`);
      }
    }

    for (const match of content.matchAll(MARKDOWN_LINK)) {
      const target = match[1];
      if (!target || isExternalOrAnchor(target)) continue;
      const resolved = resolveMarkdownTarget(file, target);
      if (!statSync(resolved, { throwIfNoEntry: false })) {
        brokenLinks.push(`${relativeFile}: broken link (${target}) → ${resolved}`);
      }
    }
  }

  if (staleHits.length === 0 && brokenLinks.length === 0) {
    console.log(`docs:links:check OK (${files.length} files scanned)`);
    return;
  }

  if (staleHits.length > 0) {
    console.error('\nStale path patterns:\n');
    for (const line of staleHits) console.error(`  ${line}`);
  }
  if (brokenLinks.length > 0) {
    console.error('\nBroken relative links:\n');
    for (const line of brokenLinks) console.error(`  ${line}`);
  }
  process.exit(1);
}

function relativePath(absolute: string): string {
  return absolute.startsWith(REPO_ROOT) ? absolute.slice(REPO_ROOT.length + 1) : absolute;
}

main();
