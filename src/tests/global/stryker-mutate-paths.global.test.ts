import { describe, it, expect } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Mutation-config integrity guard.
 *
 * Stryker only mutates the files its `mutate` globs resolve to. When a source file
 * moves (e.g. a middleware into a `core/` / `security/` subdirectory) and the
 * `mutate` entry is not updated, that file is **silently dropped** from the
 * mutation gate — the `break` threshold still passes because it is computed over a
 * shrunken scope, giving false confidence on security-critical code. This test
 * fails the moment any `mutate` entry stops resolving to a real source file, so the
 * config can never silently drift again.
 */
describe('Stryker mutate config integrity', () => {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), 'stryker.config.json'), 'utf8'),
  ) as { mutate: string[] };

  it('exposes a non-empty mutate list', () => {
    expect(Array.isArray(config.mutate)).toBe(true);
    expect(config.mutate.length).toBeGreaterThan(0);
  });

  it('every mutate entry resolves to at least one real source file (no silent drift)', () => {
    const dead = config.mutate.filter((pattern) => globSync(pattern).length === 0);
    expect(
      dead,
      `Stryker mutate entries resolve to no files — the mutation gate is silently skipping them:\n  ${dead.join('\n  ')}`,
    ).toEqual([]);
  });
});
