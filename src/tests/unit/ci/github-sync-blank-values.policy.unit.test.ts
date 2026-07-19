import { describe, expect, it } from 'vitest';
import {
  findStaleRemoteKeys,
  parseEnvContents,
  splitDeclaredEntries,
} from '@tooling/setup/github/sync-github-environments.js';

/** Runs the real reconciliation the sync uses: parse → split → stale-detect. */
function reconcile(
  localFileContents: string,
  remoteKeys: string[],
  options: { schemaDefaults?: Record<string, string>; keepSchemaDefaults?: boolean } = {},
) {
  const declared = parseEnvContents(localFileContents);
  const { pushable, blank, schemaDefault } = splitDeclaredEntries(declared, options);
  // Mirror syncEnvironmentToGitHub: schema-default variables are EXCLUDED from the
  // declared set so the prune removes any stale remote copy (runtime falls back to the
  // identical default); blank keys stay declared so their live remote value is preserved.
  const schemaDefaultNames = new Set(schemaDefault.map((entry) => entry.name));
  const stale = findStaleRemoteKeys({
    declaredNames: new Set(
      declared.map((entry) => entry.name).filter((name) => !schemaDefaultNames.has(name)),
    ),
    remoteKeys,
  });
  return {
    pushed: pushable.map((entry) => entry.name),
    blank: blank.map((entry) => entry.name),
    schemaDefault: schemaDefault.map((entry) => entry.name),
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

describe('github:sync schema-default reconciliation', () => {
  // Injected default map keeps these cases independent of the real schema's values.
  const schemaDefaults = { RATE_LIMIT_MAX: '100', LOG_LEVEL: 'info' };

  it('does not push a variable whose value equals its schema default', () => {
    const result = reconcile('RATE_LIMIT_MAX=100\nWEBHOOK_MAX_PER_ORG=999\n', [], {
      schemaDefaults,
    });
    expect(result.schemaDefault).toEqual(['RATE_LIMIT_MAX']);
    expect(result.pushed).toEqual(['WEBHOOK_MAX_PER_ORG']);
  });

  it('prunes a default-equal variable that still exists on the remote', () => {
    // Local value == default → treated as not-declared → the remote copy is stale and
    // deleted, so the runtime falls back to the identical default.
    const result = reconcile('RATE_LIMIT_MAX=100\n', ['RATE_LIMIT_MAX'], { schemaDefaults });
    expect(result.deleted).toEqual(['RATE_LIMIT_MAX']);
    expect(result.pushed).toEqual([]);
  });

  it('pushes an overriding value and keeps it declared (not pruned)', () => {
    const result = reconcile('RATE_LIMIT_MAX=500\n', ['RATE_LIMIT_MAX'], { schemaDefaults });
    expect(result.pushed).toEqual(['RATE_LIMIT_MAX']);
    expect(result.schemaDefault).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('is exact-string: an equivalent-but-differently-written value is treated as an override', () => {
    // '100.0' coerces to the same number at runtime but is not string-equal to '100',
    // so it is conservatively pushed — the tool can never wrongly drop a real override.
    const result = reconcile('RATE_LIMIT_MAX=100.0\n', [], { schemaDefaults });
    expect(result.pushed).toEqual(['RATE_LIMIT_MAX']);
    expect(result.schemaDefault).toEqual([]);
  });

  it('never treats a secret as schema-default, even if a default map lists it', () => {
    // The skip only applies to classifyKey === 'variable'; secrets are always pushed.
    const result = reconcile('STRIPE_SECRET_KEY=sk_test_x\n', [], {
      schemaDefaults: { STRIPE_SECRET_KEY: 'sk_test_x' },
    });
    expect(result.pushed).toEqual(['STRIPE_SECRET_KEY']);
    expect(result.schemaDefault).toEqual([]);
  });

  it('--keep-schema-defaults pushes the default-equal variable verbatim and keeps it declared', () => {
    const result = reconcile('RATE_LIMIT_MAX=100\n', ['RATE_LIMIT_MAX'], {
      schemaDefaults,
      keepSchemaDefaults: true,
    });
    expect(result.pushed).toEqual(['RATE_LIMIT_MAX']);
    expect(result.schemaDefault).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('uses the real envSchemaDefaults by default (PORT=3000 is the shipped default)', () => {
    expect(reconcile('PORT=3000\n', []).schemaDefault).toEqual(['PORT']);
    expect(reconcile('PORT=8080\n', []).pushed).toEqual(['PORT']);
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
