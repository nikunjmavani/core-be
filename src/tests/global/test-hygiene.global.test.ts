/**
 * Policy: no focused, skipped, or placeholder tests reach `main`.
 *
 * The suite is clean today — zero `.only`, `.skip`, and `.todo` across 850+ files. That is a state
 * worth keeping rather than rediscovering: a stray `.only` silently reduces a CI shard to one case
 * while still reporting green, and a `.skip` left behind after a debugging session is indistinguishable
 * from coverage that never existed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const SCAN_ROOT = 'src';
const SKIP_PATH_SEGMENTS = ['node_modules', 'dist'] as const;

/** `it.only`, `describe.only`, `test.only` and their `.skip` / `.todo` / `.failing` siblings. */
const FOCUSED_OR_SKIPPED_PATTERN = /\b(?:it|test|describe|suite)\s*\.\s*(only|skip|todo|failing)\b/;

/**
 * Files allowed to contain a focused or skipped test, each with the reason and a review owner.
 *
 * Quarantine is a decision, not a default — an entry here means someone owns getting it back.
 */
const ALLOWED_FILES: ReadonlyArray<{ file: string; reason: string }> = [];

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

/** Offending lines in a file, ignoring comments — this very file describes the pattern in prose. */
function findOffendingLines(relativePath: string): string[] {
  const source = readFileSync(join(PROJECT_ROOT, relativePath), 'utf8');
  const offenders: string[] = [];
  source.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (FOCUSED_OR_SKIPPED_PATTERN.test(line)) {
      offenders.push(`${relativePath}:${index + 1}  ${trimmed}`);
    }
  });
  return offenders;
}

describe('test hygiene', () => {
  const testFiles = collectTestFiles(SCAN_ROOT).sort();
  const allowedFiles = new Set(ALLOWED_FILES.map(({ file }) => file));

  it('finds test files to scan', () => {
    expect(testFiles.length).toBeGreaterThan(100);
  });

  it('no test file contains .only, .skip, .todo, or .failing', () => {
    const offenders = testFiles
      .filter((file) => !allowedFiles.has(file))
      .flatMap((file) => findOffendingLines(file));

    expect(
      offenders,
      'Focused or skipped tests found. Remove them, or add the file to ALLOWED_FILES with a\n' +
        'reason and an owner:\n\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('every allowlisted file still exists and still needs the exemption', () => {
    const stale = ALLOWED_FILES.filter(
      ({ file }) => !testFiles.includes(file) || findOffendingLines(file).length === 0,
    ).map(({ file }) => file);

    expect(stale, `Stale allowlist entries — remove them:\n${stale.join('\n')}`).toEqual([]);
  });
});
