import { describe, expect, it } from 'vitest';
import {
  findStaleRemoteKeys,
  parseEnvContents,
  splitDeclaredEntries,
} from '@tooling/setup/github/sync-github-environments.js';

/** Runs the real reconciliation the sync uses: parse → split → stale-detect. */
function reconcile(localFileContents: string, remoteKeys: string[]) {
  const declared = parseEnvContents(localFileContents);
  const { pushable, blank } = splitDeclaredEntries(declared);
  const stale = findStaleRemoteKeys({
    declaredNames: new Set(declared.map((entry) => entry.name)),
    remoteKeys,
  });
  return {
    pushed: pushable.map((entry) => entry.name),
    blank: blank.map((entry) => entry.name),
    deleted: stale,
  };
}

describe('parseEnvContents', () => {
  it('retains blank-valued keys as declared', () => {
    // If blanks were dropped here, they would look absent to stale-detection and
    // the live remote value would be deleted.
    expect(parseEnvContents('A=\nB=set\n')).toEqual([
      { name: 'A', value: '' },
      { name: 'B', value: 'set' },
    ]);
  });
});

describe('github:sync blank-value reconciliation', () => {
  it('never deletes a remote value just because the local value is blank', () => {
    // Regression: blanking a line used to drop the key from the local set, so
    // stale-detection deleted the live secret from the GitHub Environment — the
    // opposite of the contract documented in the file header and .env.example.
    const result = reconcile('STRIPE_SECRET_KEY=\nDATABASE_URL=postgres://x\n', [
      'STRIPE_SECRET_KEY',
      'DATABASE_URL',
    ]);
    expect(result.deleted).toEqual([]);
    expect(result.blank).toEqual(['STRIPE_SECRET_KEY']);
  });

  it('does not push a blank value (an empty secret is worse than an absent one)', () => {
    const result = reconcile('CAPTCHA_SECRET=\nDATABASE_URL=postgres://x\n', []);
    expect(result.pushed).toEqual(['DATABASE_URL']);
    expect(result.pushed).not.toContain('CAPTCHA_SECRET');
  });

  it('still deletes a remote key whose line was removed entirely', () => {
    // The file remains the source of truth: absent means delete.
    expect(reconcile('DATABASE_URL=postgres://x\n', ['DATABASE_URL', 'OLD_KEY']).deleted).toEqual([
      'OLD_KEY',
    ]);
  });

  it('distinguishes blank-declared from absent for the same key', () => {
    expect(reconcile('OPTIONAL_KEY=\n', ['OPTIONAL_KEY']).deleted).toEqual([]);
    expect(reconcile('OTHER=1\n', ['OPTIONAL_KEY']).deleted).toEqual(['OPTIONAL_KEY']);
  });
});

describe('findStaleRemoteKeys', () => {
  it('treats a declared-but-blank name as present, not stale', () => {
    expect(
      findStaleRemoteKeys({ declaredNames: new Set(['KEEP']), remoteKeys: ['KEEP', 'DROP'] }),
    ).toEqual(['DROP']);
  });

  it('returns nothing when the remote has no keys', () => {
    expect(findStaleRemoteKeys({ declaredNames: new Set(['A']), remoteKeys: [] })).toEqual([]);
  });
});
