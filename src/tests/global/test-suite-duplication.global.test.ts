/**
 * Policy: two test files must not assert the same thing under the same title.
 *
 * Five domains discovered near-duplicate suites by hand during the coverage pass — audit found a
 * byte-identical pair, auth 33 shared titles, user 21, notify 44 cases with two unique ones between
 * them. Every one of those pairs was DB-bound, so the duplication cost real CI minutes on every run.
 *
 * This gate finds the next one automatically. It compares the `it()` titles of every pair of test
 * files and fails when an overlap exceeds the threshold, so a copied-then-diverged suite is caught
 * while it is still cheap to split.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const SCAN_ROOT = 'src';
const SKIP_PATH_SEGMENTS = ['node_modules', 'dist'] as const;

/**
 * Maximum number of identical `it()` titles two test files may share.
 *
 * Four is deliberate: a handful of collisions on generic titles ("returns 401 without a token") is
 * normal and healthy, while a copied suite shares far more than that.
 */
const MAX_SHARED_TITLES = 4;

/**
 * Test-type suffixes stripped to derive a file's subject.
 *
 * Only files with the same subject are compared. Two suites that share titles while testing
 * *different* subjects are the deliberate template pattern — every retention worker's wiring test
 * asserts the same five things about a different worker — and that is reuse, not duplication.
 * The costly case this gate exists for is one subject asserted twice across projects.
 */
const TEST_TYPE_SUFFIXES = [
  '.db.unit.test.ts',
  '.property.unit.test.ts',
  '.policy.unit.test.ts',
  '.global.test.ts',
  '.security.test.ts',
  '.performance.test.ts',
  '.contract.test.ts',
  '.integration.test.ts',
  '.smoke.test.ts',
  '.chaos.test.ts',
  '.e2e.test.ts',
  '.unit.test.ts',
  '.test.ts',
] as const;

/**
 * Pairs allowed to exceed the threshold, each with the reason.
 *
 * A pair belongs here only when both files are structurally required AND the overlap is intentional.
 * Prefer splitting the files by responsibility (gates vs response contract) over adding an entry.
 */
const ALLOWED_PAIRS: ReadonlyArray<{ files: readonly [string, string]; reason: string }> = [];

const TITLE_PATTERN = /^\s*it(?:\.each\([\s\S]*?\))?\s*(?:\.\w+)?\s*\(\s*(['"`])([\s\S]*?)\1/;

function collectTestFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const relativePath = relative(PROJECT_ROOT, fullPath);
    if (SKIP_PATH_SEGMENTS.some((segment) => relativePath.split('/').includes(segment))) {
      continue;
    }
    if (statSync(fullPath).isDirectory()) {
      collectTestFiles(fullPath, files);
      continue;
    }
    if (entry.endsWith('.test.ts')) {
      files.push(relativePath);
    }
  }
  return files;
}

function extractTitles(relativePath: string): Set<string> {
  const source = readFileSync(join(PROJECT_ROOT, relativePath), 'utf8');
  const titles = new Set<string>();
  for (const line of source.split('\n')) {
    const match = TITLE_PATTERN.exec(line);
    if (match?.[2]) {
      titles.add(match[2].trim());
    }
  }
  return titles;
}

/** The file's subject: its basename with the test-type suffix removed. */
function subjectOf(relativePath: string): string {
  const basename = relativePath.split('/').pop() ?? relativePath;
  const suffix = TEST_TYPE_SUFFIXES.find((candidate) => basename.endsWith(candidate));
  return suffix ? basename.slice(0, -suffix.length) : basename;
}

function isAllowedPair(first: string, second: string): boolean {
  return ALLOWED_PAIRS.some(
    ({ files }) =>
      (files[0] === first && files[1] === second) || (files[0] === second && files[1] === first),
  );
}

/** Files grouped by subject — only same-subject files can be duplicate suites. */
function groupBySubject(files: readonly string[]): string[][] {
  const bySubject = new Map<string, string[]>();
  for (const file of files) {
    const subject = subjectOf(file);
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), file]);
  }
  return [...bySubject.values()].filter((group) => group.length > 1);
}

/** Titles shared by two files, or `[]` when either is too small to be a duplicated suite. */
function sharedTitles(
  first: string,
  second: string,
  titlesByFile: ReadonlyMap<string, Set<string>>,
): string[] {
  const firstTitles = titlesByFile.get(first);
  const secondTitles = titlesByFile.get(second);
  if (firstTitles === undefined || secondTitles === undefined) return [];
  if (firstTitles.size <= MAX_SHARED_TITLES || secondTitles.size <= MAX_SHARED_TITLES) return [];
  return [...firstTitles].filter((title) => secondTitles.has(title));
}

function describeOverlap(first: string, second: string, shared: readonly string[]): string {
  const sample = shared
    .slice(0, 3)
    .map((title) => `"${title}"`)
    .join(', ');
  return `${first}\n  ${second}\n  shares ${shared.length} titles, e.g. ${sample}`;
}

describe('test suite duplication', () => {
  const testFiles = collectTestFiles(SCAN_ROOT).sort();
  const titlesByFile = new Map(testFiles.map((file) => [file, extractTitles(file)]));

  it('finds test files to scan', () => {
    expect(testFiles.length).toBeGreaterThan(100);
  });

  it(`no two suites for one subject share more than ${MAX_SHARED_TITLES} identical it() titles`, () => {
    const offenders: string[] = [];

    for (const group of groupBySubject(testFiles)) {
      for (const [index, first] of group.entries()) {
        for (const second of group.slice(index + 1)) {
          if (isAllowedPair(first, second)) continue;
          const shared = sharedTitles(first, second, titlesByFile);
          if (shared.length > MAX_SHARED_TITLES) {
            offenders.push(describeOverlap(first, second, shared));
          }
        }
      }
    }

    expect(
      offenders,
      `Near-duplicate test suites found. Split them by responsibility — one file owns the route\n` +
        `gates, the other owns what comes back through them — rather than asserting both twice:\n\n` +
        offenders.join('\n\n'),
    ).toEqual([]);
  });

  it('every allowlisted pair still exists and still overlaps', () => {
    const stale: string[] = [];

    for (const { files } of ALLOWED_PAIRS) {
      const [first, second] = files;
      const bothPresent = testFiles.includes(first) && testFiles.includes(second);
      if (!bothPresent) {
        stale.push(`${first} <-> ${second}: a file no longer exists`);
        continue;
      }

      const shared = sharedTitles(first, second, titlesByFile);
      if (shared.length <= MAX_SHARED_TITLES) {
        stale.push(`${first} <-> ${second}: now shares only ${shared.length} titles`);
      }
    }

    expect(stale, `Stale allowlist entries — remove them:\n${stale.join('\n')}`).toEqual([]);
  });
});
