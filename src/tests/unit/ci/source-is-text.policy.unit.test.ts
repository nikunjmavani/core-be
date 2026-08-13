import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Keeps `src/` and `tooling/` reviewable: source must be text a human reads in a diff.
 *
 * A binary blob, a minified bundle or a vendored megabyte slips through review because the diff
 * is unreadable — which is exactly what makes it a supply-chain and secret-leak vector. It also
 * defeats every other gate in the repo: Biome, SonarQube, gitleaks and Semgrep all reason over
 * text, so anything they cannot parse is effectively unscanned.
 *
 * Ported from the sibling frontend repository's `source-is-text.policy` suite, which this
 * repository had no equivalent of.
 */

const ROOT = process.cwd();
const SCANNED_ROOTS = ['src', 'tooling'];

/** Extensions that are legitimately binary and are allowed where they appear. */
const ALLOWED_BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico', '.svg']);

/** Directories that never contain reviewed source. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'coverage', 'dist', '.git', 'test-results']);

const MAX_SOURCE_BYTES = 512 * 1024;

interface ScannedFile {
  readonly path: string;
  readonly bytes: number;
}

function walk(directory: string, collected: ScannedFile[] = []): ScannedFile[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, collected);
      continue;
    }
    if (!entry.isFile()) continue;
    collected.push({ path: relative(ROOT, full), bytes: statSync(full).size });
  }
  return collected;
}

const files = SCANNED_ROOTS.flatMap((root) => walk(join(ROOT, root)));

function extensionOf(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index).toLowerCase();
}

/** A NUL byte in the first 8KB is the standard heuristic for "this file is not text". */
function looksBinary(path: string): boolean {
  const buffer = readFileSync(join(ROOT, path));
  return buffer.subarray(0, 8192).includes(0);
}

describe('source is reviewable text', () => {
  it('scans a non-trivial number of files (the walker is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('contains no binary files outside the allowed asset extensions', () => {
    const offenders = files
      .filter((file) => !ALLOWED_BINARY_EXTENSIONS.has(extensionOf(file.path)))
      .filter((file) => looksBinary(file.path))
      .map((file) => file.path);

    expect(offenders, `binary files found under ${SCANNED_ROOTS.join('/')}`).toEqual([]);
  });

  it('contains no minified bundles', () => {
    const offenders = files
      .filter((file) => /\.min\.(js|mjs|cjs|css)$/.test(file.path))
      .map((file) => file.path);

    expect(offenders, 'minified bundles are not reviewable source').toEqual([]);
  });

  it('contains no source map files', () => {
    // Source maps are build output; committed under src/ they bloat diffs and can embed
    // absolute local paths from whoever generated them.
    const offenders = files.filter((file) => file.path.endsWith('.map')).map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('keeps every source file under the review size ceiling', () => {
    const offenders = files
      .filter((file) => file.bytes > MAX_SOURCE_BYTES)
      .map((file) => `${file.path} (${Math.round(file.bytes / 1024)}KB)`);

    expect(
      offenders,
      `files above ${MAX_SOURCE_BYTES / 1024}KB are not practically reviewable`,
    ).toEqual([]);
  });

  it('has no stray archive or compiled artifacts', () => {
    const offenders = files
      .filter((file) => /\.(zip|tar|gz|tgz|jar|exe|dll|so|dylib|wasm|node)$/i.test(file.path))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});
