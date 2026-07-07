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
    // Exact display name — the required-check context (`RLS security (non-superuser)`)
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

/**
 * The job is only a real gate if it is also a REQUIRED status check — otherwise auto-merge ignores
 * it. GitHub Actions report a status-check context as the bare check-run name (the job `name:`), NOT
 * prefixed by the workflow — so the ruleset context is `RLS security (non-superuser)`, matching the
 * job `name:` asserted above. (Prefixing it `PR CI / …` matches no real check and silently blocks
 * every merge — the bug this guard now pins against.) These assertions fail if a branch ruleset
 * drops the RLS context or a job rename desyncs the two.
 */
const REQUIRED_RLS_CONTEXT = 'RLS security (non-superuser)';

interface BranchRuleset {
  rules: {
    type: string;
    parameters?: { required_status_checks?: { context: string }[] };
  }[];
}

describe.each(['main'])('the %s branch ruleset requires the RLS check', (branch) => {
  it('lists the RLS context in required_status_checks', () => {
    const ruleset = JSON.parse(
      readFileSync(join(process.cwd(), `.github/rulesets/${branch}.json`), 'utf8'),
    ) as BranchRuleset;

    const requiredContexts = ruleset.rules
      .find((rule) => rule.type === 'required_status_checks')
      ?.parameters?.required_status_checks?.map((check) => check.context);

    expect(requiredContexts, `${branch}.json must declare required_status_checks`).toBeDefined();
    expect(requiredContexts).toContain(REQUIRED_RLS_CONTEXT);
  });
});

/**
 * Single-trunk: `main` is maintained solo, so its ruleset requires status checks but **0 approvals**
 * (D8) — a red check (incl. RLS) still blocks the merge, but the author isn't locked out waiting for
 * an approval they can't give (the pre-migration params — 1 approval + code-owner + last-push — were
 * promotion-gate settings that locked out solo merges). Guard against a silent regression to a
 * non-zero count. Change this deliberately if/when a second reviewer is added.
 */
it('the main ruleset requires 0 approvals (solo maintainer — checks still block merge)', () => {
  const mainRuleset = JSON.parse(
    readFileSync(join(process.cwd(), '.github/rulesets/main.json'), 'utf8'),
  ) as { rules: { type: string; parameters?: { required_approving_review_count?: number } }[] };

  const pullRequestRule = mainRuleset.rules.find((rule) => rule.type === 'pull_request');
  expect(
    pullRequestRule,
    'main.json must keep a pull_request rule (changes go via a PR)',
  ).toBeDefined();
  expect(pullRequestRule?.parameters?.required_approving_review_count).toBe(0);
});
