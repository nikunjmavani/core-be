import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the merge gate on `main`.
 *
 * The one place ruleset rule CONTENT is pinned: the weekly canary can only check
 * ruleset PRESENCE (its Actions token cannot read secrets to diff parameters), and
 * `pnpm github:sync --prune` pushes whatever this file says — so a weakened rule here
 * would silently ship to the live branch protection on the next sync.
 *
 * Central invariant: `bypass_actors` is EMPTY. A repo-admin `pull_request` bypass once
 * let a red `Quality gate` merge through the merge API (core-be #911). With no bypass
 * actors, a failing/pending required check blocks the merge for everyone — the repo
 * owner included. This test fails the build if the bypass is ever re-added.
 */
const RULESET_PATH = join(process.cwd(), '.github/rulesets/main.json');

interface RulesetRule {
  readonly type: string;
  readonly parameters?: {
    readonly allowed_merge_methods?: readonly string[];
    readonly strict_required_status_checks_policy?: boolean;
    readonly required_status_checks?: ReadonlyArray<{
      readonly context: string;
    }>;
  };
}

interface Ruleset {
  readonly name: string;
  readonly target: string;
  readonly bypass_actors?: readonly unknown[];
  readonly conditions?: {
    readonly ref_name?: { readonly include?: readonly string[] };
  };
  readonly rules: readonly RulesetRule[];
}

const ruleset = JSON.parse(readFileSync(RULESET_PATH, 'utf8')) as Ruleset;

describe('main branch ruleset policy (no bypass, checks absolute)', () => {
  it('targets main only and is named "Protect main"', () => {
    expect(ruleset.target).toBe('branch');
    expect(ruleset.conditions?.ref_name?.include).toEqual(['refs/heads/main']);
    expect(ruleset.name).toBe('Protect main');
  });

  it('has NO bypass actors — a red/pending required check cannot be merged by anyone', () => {
    // Never re-add these: a bypass actor bypasses the WHOLE ruleset, required checks included.
    expect(ruleset.bypass_actors ?? []).toEqual([]);
  });

  it('requires the Quality gate + Checks contexts, squash-only, linear history', () => {
    const ruleTypes = ruleset.rules.map((rule) => rule.type);
    expect(ruleTypes).toEqual(
      expect.arrayContaining([
        'required_linear_history',
        'pull_request',
        'required_status_checks',
        'deletion',
        'non_fast_forward',
      ]),
    );
    const pullRequest = ruleset.rules.find((rule) => rule.type === 'pull_request');
    expect(pullRequest?.parameters?.allowed_merge_methods).toEqual(['squash']);
    const checks = ruleset.rules.find((rule) => rule.type === 'required_status_checks');
    const contexts = (checks?.parameters?.required_status_checks ?? []).map((c) => c.context);
    expect(contexts).toEqual(expect.arrayContaining(['Quality gate', 'Checks']));
  });

  it('does not require branches to be up to date (strict off) so a green PR merges cleanly', () => {
    const checks = ruleset.rules.find((rule) => rule.type === 'required_status_checks');
    expect(checks?.parameters?.strict_required_status_checks_policy).toBe(false);
  });

  it('does NOT pin required_signatures — unsigned branch commits would deadlock every PR', () => {
    // The squash-merge commit GitHub writes to main is signed regardless; see branch-protection.md.
    expect(ruleset.rules.map((rule) => rule.type)).not.toContain('required_signatures');
  });
});
