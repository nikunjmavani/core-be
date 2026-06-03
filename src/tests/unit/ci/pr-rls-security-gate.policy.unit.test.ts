import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: the non-superuser RLS suite must run on the PR gate, not post-merge only.
 *
 * FORCE ROW LEVEL SECURITY bugs are invisible under the local/CI superuser; they surface only when
 * tests run as the non-superuser `core_be_app` role against a real Postgres. The org-mandated-MFA
 * bypass reached production partly because the RLS suite ran post-merge only — too late to block the
 * merge. This test fails if the PR-gate RLS job is removed, stops running the `rls` test directory,
 * or loses its database.
 */
const prCiPath = join(process.cwd(), '.github/workflows/pr-ci.yml');

describe('PR CI runs the non-superuser RLS security suite against Postgres', () => {
  const prCi = readFileSync(prCiPath, 'utf8');

  it('declares the rls-security job', () => {
    expect(prCi).toContain('rls-security:');
    // Exact display name — the required-check context (`PR CI / RLS security (non-superuser)`)
    // in .github/rulesets/*.json is derived from it, so a rename here must stay in sync.
    expect(prCi).toContain('name: RLS security (non-superuser)');
  });

  it('runs the RLS test directory under the security project', () => {
    expect(prCi).toContain('--project security src/tests/security/rls');
  });

  it('provisions Postgres and migrates before the suite (the RLS tests need a real database)', () => {
    expect(prCi).toContain('postgres:17');
    // `pnpm db:migrate` (not `:lint`) is unique to this job within pr-ci.yml.
    expect(prCi).toContain('pnpm db:migrate\n');
  });

  it('skips docs-only PRs but runs on source/ci changes', () => {
    expect(prCi).toContain("needs.changes.outputs.docs-only-md != 'true'");
    expect(prCi).toContain("needs.changes.outputs.src-code == 'true'");
  });
});
