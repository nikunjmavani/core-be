/**
 * Policy: serializers are the ONLY layer that shapes response bodies, so a
 * secret-shaped key in a serializer IS a secret on the wire.
 *
 * Two rules, both static:
 *
 * 1. No serializer output key may look like credential material — `password`,
 *    `*_hash` / `hash`, `secret` / `*_secret`, or `encrypted*`. The one
 *    reviewed exception (the TOTP provisioning `secret` revealed exactly once
 *    at MFA enrollment) is allowlisted by file + key.
 * 2. No serializer spreads a whole row/input object into a response
 *    (`...row`), because a spread republishes every column — including ones
 *    added later — without any reviewed key list.
 *
 * `snake-case-body-keys.policy.unit.test.ts` checks the CASING of these keys;
 * this test checks their CONTENT class. Timestamps like `secret_rotated_at`
 * do not match (the patterns anchor on the key's terminal noun).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const DOMAINS_ROOT = join(PROJECT_ROOT, 'src/domains');

/** Key patterns that mean credential material when used as a response key. */
const FORBIDDEN_KEY_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'password', pattern: /password/ },
  { name: 'hash', pattern: /(^|_)hash$/ },
  { name: 'secret', pattern: /(^|_)secret$/ },
  { name: 'encrypted', pattern: /encrypted/ },
  { name: 'private_key', pattern: /private_key/ },
];

/**
 * Reviewed exceptions, keyed `file → key`. Each entry must say WHY the reveal
 * is intentional.
 */
const REVIEWED_SECRET_REVEALS = new Set<string>([
  // TOTP enrollment: the provisioning secret is shown exactly once so the user
  // can seed their authenticator app; it is never readable again afterwards.
  'src/domains/auth/auth.serializer.ts → secret',
]);

function collectSerializerFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === '__tests__' || entry === 'seed') continue;
      collectSerializerFiles(fullPath, accumulator);
      continue;
    }
    if (entry.endsWith('.serializer.ts')) accumulator.push(relative(PROJECT_ROOT, fullPath));
  }
  return accumulator;
}

/** Extracts candidate object-literal keys (`key:` / `'key':`) from serializer source. */
function extractObjectKeys(source: string): string[] {
  const keys: string[] = [];
  for (const line of source.split('\n')) {
    const match = line.match(/^\s*(?:'([a-z0-9_]+)'|([a-z0-9_]+))\s*:/);
    const key = match?.[1] ?? match?.[2];
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

describe('Global: serializer response leak guard', () => {
  const serializerFiles = collectSerializerFiles(DOMAINS_ROOT);

  it('finds serializer files to scan', () => {
    expect(serializerFiles.length).toBeGreaterThanOrEqual(15);
  });

  it('no serializer emits a credential-shaped output key (outside reviewed reveals)', () => {
    const violations: string[] = [];
    for (const filePath of serializerFiles) {
      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      for (const key of extractObjectKeys(source)) {
        const matched = FORBIDDEN_KEY_PATTERNS.find(({ pattern }) => pattern.test(key));
        if (!matched) continue;
        const entry = `${filePath} → ${key}`;
        if (REVIEWED_SECRET_REVEALS.has(entry)) continue;
        violations.push(`${entry} (matched: ${matched.name})`);
      }
    }
    expect(
      violations,
      'Credential-shaped key found in a serializer. Response bodies must never carry ' +
        'password/hash/secret/encrypted material — drop the field, or (for a deliberate ' +
        'one-time reveal) add a justified entry to REVIEWED_SECRET_REVEALS.',
    ).toEqual([]);
  });

  it('every reviewed reveal still exists (no stale allowlist entries)', () => {
    const liveEntries = new Set<string>();
    for (const filePath of serializerFiles) {
      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      for (const key of extractObjectKeys(source)) {
        liveEntries.add(`${filePath} → ${key}`);
      }
    }
    const stale = [...REVIEWED_SECRET_REVEALS].filter((entry) => !liveEntries.has(entry));
    expect(stale, 'Reviewed reveal no longer present — remove the allowlist entry.').toEqual([]);
  });

  it('no serializer spreads a whole row/input object into a response', () => {
    const violations: string[] = [];
    const spreadOfParameter = /\.\.\.(row|data|input|record|entity)\b/;
    for (const filePath of serializerFiles) {
      const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
      const match = source.match(spreadOfParameter);
      if (match) violations.push(`${filePath} → ${match[0]}`);
    }
    expect(
      violations,
      'Serializer spreads a whole object into the response — list every key explicitly ' +
        'so new columns never leak by default.',
    ).toEqual([]);
  });
});
