import { describe, expect, it } from 'vitest';
import {
  classifyRetry,
  computeMutationDelayMs,
  findStaleRemoteKeys,
  formatSyncPreviewTable,
  parseEnvContents,
  planEnvironmentSyncPreview,
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

describe('computeMutationDelayMs (write jitter — anti secondary-rate-limit)', () => {
  const MIN_DRAW = () => 0; // lowest jitter
  const MAX_DRAW = () => 0.999_999_999; // highest jitter (Math.random is [0, 1))

  it('floors a sub-floor dynamic delay and always adds a positive jitter (never a fixed cadence)', () => {
    // A bare fixed 1.1s cadence is what tripped GitHub's secondary abuse limit; every write must
    // carry a strictly-positive random jitter on top of the floor.
    const low = computeMutationDelayMs(0, MIN_DRAW);
    const high = computeMutationDelayMs(0, MAX_DRAW);
    expect(low).toBeGreaterThan(1_100); // floor(1_100) + minJitter(>0)
    expect(high).toBeGreaterThan(low); // the jitter genuinely varies the spacing
  });

  it('lets a dynamic delay larger than the floor win, jitter unchanged for an equal draw', () => {
    // Delta between a large base and the floor case, at the same random draw, is exactly
    // base-minus-floor — proving the floor is 1_100 and the jitter term is identical.
    const withFloor = computeMutationDelayMs(0, MIN_DRAW);
    const withLargeBase = computeMutationDelayMs(10_000, MIN_DRAW);
    expect(withLargeBase - withFloor).toBe(10_000 - 1_100);
  });

  it('keeps every delay inside a bounded band — no unbounded, zero, or negative waits', () => {
    const lo = computeMutationDelayMs(0, MIN_DRAW);
    const hi = computeMutationDelayMs(0, MAX_DRAW);
    expect(hi - lo).toBeGreaterThan(0); // a real jitter span
    for (let i = 0; i < 200; i += 1) {
      const delay = computeMutationDelayMs(0, Math.random);
      expect(delay).toBeGreaterThanOrEqual(lo);
      expect(delay).toBeLessThanOrEqual(hi);
    }
  });

  it('is deterministic for a given draw — the same logic runs every time', () => {
    expect(computeMutationDelayMs(500, () => 0.5)).toBe(computeMutationDelayMs(500, () => 0.5));
  });
});

describe('classifyRetry (5-minute hold on abuse-limit errors)', () => {
  const FIVE_MIN_MS = 5 * 60_000;

  it('holds a flat 5 minutes for a 429 secondary rate limit, with a long retry budget', () => {
    const d = classifyRetry({
      status: 429,
      responseText: 'You have exceeded a secondary rate limit. Please wait a few minutes.',
      attempt: 0,
      retryAfterMs: null,
    });
    expect(d.retryable).toBe(true);
    expect(d.secondaryRateLimit).toBe(true);
    expect(d.waitMs).toBe(FIVE_MIN_MS);
    expect(d.maxRetries).toBeGreaterThanOrEqual(12); // enough holds to ride out an ~hour penalty
  });

  it('treats a 403 "Too many requests" abuse page as a retryable secondary limit (not a perm error)', () => {
    const d = classifyRetry({
      status: 403,
      responseText: '<html><title>Too many requests</title></html>',
      attempt: 3,
      retryAfterMs: null,
    });
    expect(d.retryable).toBe(true);
    expect(d.secondaryRateLimit).toBe(true);
    expect(d.waitMs).toBe(FIVE_MIN_MS);
  });

  it('holds the SAME 5 minutes on every secondary-limit attempt (a flat hold, never escalating away)', () => {
    const body = 'secondary rate limit';
    const first = classifyRetry({
      status: 429,
      responseText: body,
      attempt: 0,
      retryAfterMs: null,
    });
    const later = classifyRetry({
      status: 429,
      responseText: body,
      attempt: 9,
      retryAfterMs: null,
    });
    expect(first.waitMs).toBe(FIVE_MIN_MS);
    expect(later.waitMs).toBe(FIVE_MIN_MS);
  });

  it('never waits less than the server Retry-After when it exceeds the 5-minute hold', () => {
    const d = classifyRetry({
      status: 429,
      responseText: 'secondary rate limit',
      attempt: 0,
      retryAfterMs: 10 * 60_000,
    });
    expect(d.waitMs).toBe(10 * 60_000);
  });

  it('uses the short escalating backoff for a plain 5xx (not the 5-minute hold)', () => {
    const d = classifyRetry({ status: 500, responseText: 'oops', attempt: 0, retryAfterMs: null });
    expect(d.retryable).toBe(true);
    expect(d.secondaryRateLimit).toBe(false);
    expect(d.waitMs).toBeLessThan(FIVE_MIN_MS);
  });

  it('does not retry a real 403 permission error (no abuse body) or a 404', () => {
    expect(
      classifyRetry({
        status: 403,
        responseText: 'Resource not accessible',
        attempt: 0,
        retryAfterMs: null,
      }).retryable,
    ).toBe(false);
    expect(
      classifyRetry({ status: 404, responseText: 'Not Found', attempt: 0, retryAfterMs: null })
        .retryable,
    ).toBe(false);
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

describe('planEnvironmentSyncPreview', () => {
  const schemaDefaults = { RATE_LIMIT_MAX: '100', PORT: '3000' };
  const declared = parseEnvContents(
    [
      'RATE_LIMIT_MAX=100', // == default, on remote → skip+prune
      'PORT=3000', // == default, absent → skip
      'LOG_LEVEL=debug', // override, on remote same → unchanged
      'FRONTEND_URL=http://a', // override, on remote different → update
      'WEBHOOK_MAX_PER_ORG=5', // override, absent → create
      'STRIPE_SECRET_KEY=sk_live_do_not_print', // secret, on remote → secret
      'JWT_SECRET=xyz', // secret, absent → secret-create
      'OPTIONAL=', // blank
    ].join('\n'),
  );
  const remoteVariables = new Map([
    ['RATE_LIMIT_MAX', '100'],
    ['LOG_LEVEL', 'debug'],
    ['FRONTEND_URL', 'http://remote'],
    ['OLD_VAR', 'gone'], // stale → prune-stale
  ]);
  const remoteSecretNames = new Set(['STRIPE_SECRET_KEY']);
  const rows = planEnvironmentSyncPreview({
    declared,
    remoteVariables,
    remoteSecretNames,
    schemaDefaults,
  });
  const byName = new Map(rows.map((row) => [row.name, row]));

  it('classifies each key with the same rules the sync uses', () => {
    expect(byName.get('RATE_LIMIT_MAX')?.decision).toBe('skip+prune');
    expect(byName.get('PORT')?.decision).toBe('skip');
    expect(byName.get('LOG_LEVEL')?.decision).toBe('unchanged');
    expect(byName.get('FRONTEND_URL')?.decision).toBe('update');
    expect(byName.get('WEBHOOK_MAX_PER_ORG')?.decision).toBe('create');
    expect(byName.get('STRIPE_SECRET_KEY')?.decision).toBe('secret');
    expect(byName.get('JWT_SECRET')?.decision).toBe('secret-create');
    expect(byName.get('OPTIONAL')?.decision).toBe('blank');
  });

  it('reports a remote key with no local line as prune-stale', () => {
    expect(byName.get('OLD_VAR')?.decision).toBe('prune-stale');
  });

  it('never surfaces a secret value — local and remote are masked', () => {
    const secret = byName.get('STRIPE_SECRET_KEY');
    expect(secret?.local).not.toContain('sk_live');
    expect(secret?.remote).not.toContain('sk_live');
    expect(secret?.local).toBe('••••');
    expect(secret?.remote).toBe('••••');
    expect(secret?.schemaDefault).toBeNull();
  });

  it('emits a schema-default-on-remote variable exactly once (skip+prune, never also prune-stale)', () => {
    const matches = rows.filter((row) => row.name === 'RATE_LIMIT_MAX');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.decision).toBe('skip+prune');
  });

  it('formatSyncPreviewTable renders a header, the rows, and a per-decision summary', () => {
    const table = formatSyncPreviewTable({ rows, environment: 'development' });
    expect(table).toContain('VARIABLE');
    expect(table).toContain('DECISION');
    expect(table).toContain('development');
    expect(table).toContain(`total=${rows.length}`);
    expect(table).toContain('skip+prune=1');
    expect(table).not.toContain('sk_live'); // secret values never leak into the table
  });
});
