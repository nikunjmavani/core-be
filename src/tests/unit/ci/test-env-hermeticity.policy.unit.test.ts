import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the test harness's env-override model.
 *
 * This API and its sibling frontend repository solve test-env hermeticity differently, and the
 * difference is deliberate. The frontend points Vitest's `envDir` at an empty directory so the
 * runner loads no `.env` files at all — it never needs one. This repository cannot: its
 * integration, e2e and RLS tiers need a real
 * `DATABASE_URL` and `REDIS_URL`, so `src/tests/setup.ts` loads `.env.local` and then OVERRIDES
 * every behaviour- and security-critical flag with an explicit test value.
 *
 * That model is only sound while the overrides are actually there. Delete one line and the
 * developer's `.env.local` silently supplies the value instead — the suite keeps passing on the
 * machine that has the "right" local env and fails, or worse quietly tests something different,
 * everywhere else. The frontend pins its hermeticity wiring with a policy test; this is the
 * equivalent for this repository.
 */

const ROOT = process.cwd();
const setup = readFileSync(join(ROOT, 'src/tests/setup.ts'), 'utf8');

/** Reads the literal a setup override assigns, ignoring whitespace. */
function assignedValue(key: string): string | null {
  const match = new RegExp(`process\\.env\\.${key}\\s*=\\s*'([^']*)'`).exec(setup);
  return match?.[1] ?? null;
}

function overrides(key: string): boolean {
  return new RegExp(`process\\.env\\.${key}\\s*=`).test(setup);
}

describe('test harness env-override policy', () => {
  it('loads the env files before overriding (the DB tiers need real connection strings)', () => {
    expect(setup).toContain("import '@/shared/config/load-env-files.js'");
  });

  it('runs the suite as the development NODE_ENV the schema accepts', () => {
    // The env enum rejects `test`; an out-of-enum value fails loudly at boot.
    expect(assignedValue('NODE_ENV')).toBe('development');
  });

  it('sets TEST_MODE — the single gate for every test-only affordance', () => {
    // CLAUDE.md: one behaviour, exactly one env variable. The destructive wipe helpers gate on
    // TEST_MODE ALONE, so this must never become a combination of flags.
    expect(assignedValue('TEST_MODE')).toBe('true');
  });

  describe('security-critical flags are pinned, never inherited from .env.local', () => {
    it.each([
      ['CAPTCHA_PROVIDER', 'disabled'],
      ['DATABASE_SSL_ENABLED', 'false'],
      ['BLOCK_DISPOSABLE_EMAIL', 'false'],
      ['HTTP_BIND_HOST', '127.0.0.1'],
    ])('%s is fixed to "%s"', (key, expected) => {
      expect(assignedValue(key), `setup.ts must pin ${key}`).toBe(expected);
    });

    it.each([
      'JWT_PRIVATE_KEY',
      'JWT_PUBLIC_KEY',
      'METRICS_SCRAPE_TOKEN',
      'REDIS_KEY_PREFIX',
      'ALLOWED_ORIGINS',
    ])('%s is assigned by the harness', (key) => {
      // A machine-supplied signing key or origin allowlist would make auth and CORS tests
      // pass or fail for reasons that have nothing to do with the code under test.
      expect(overrides(key), `setup.ts must assign ${key}`).toBe(true);
    });
  });

  describe('the local-database guard', () => {
    it('redirects DATABASE_URL to the local test database by default', () => {
      // Without this a stray hosted DATABASE_URL in .env.local would point the destructive
      // cleanupDatabase() helpers at a real environment.
      expect(setup).toContain('LOCAL_TEST_DATABASE_URL');
      expect(setup).toMatch(/process\.env\.DATABASE_URL\s*=\s*LOCAL_TEST_DATABASE_URL/);
      expect(setup).toMatch(/process\.env\.DATABASE_MIGRATION_URL\s*=\s*LOCAL_TEST_DATABASE_URL/);
    });

    it('keeps exactly two documented escape hatches', () => {
      // CI supplies its own ephemeral database; ALLOW_HOSTED_TEST_DATABASE is the explicit,
      // named opt-in. Anything else silently widening this guard is a regression.
      expect(setup).toContain("process.env.CI === 'true'");
      expect(setup).toContain("process.env.ALLOW_HOSTED_TEST_DATABASE === 'true'");
    });
  });

  it('isolates Redis behind a test key prefix', () => {
    // Shared Redis without a per-suite prefix lets one run's keys leak into the next.
    expect(setup).toMatch(/REDIS_KEY_PREFIX\s*=\s*`\$\{REDIS_KEY_PREFIX_STEM\}:test:`/);
  });

  it('never branches on NODE_ENV to decide behaviour', () => {
    // The harness ASSIGNS NODE_ENV once; comparing it here would reintroduce the branching
    // that no-nodeenv-branching.global.test.ts forbids in runtime code.
    expect(setup).not.toMatch(/process\.env\.NODE_ENV\s*===/);
  });
});
