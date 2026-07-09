import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveGitMetadata } from '@tooling/setup/codegen/project-identity.util.js';
import { loadConfig } from '@tooling/setup/common/config.js';
import {
  applyGovernanceMode,
  codeownerUsers,
  detectProductionMode,
  detectRulesetMode,
  findGovernanceIssues,
  parseCodeownersOwners,
} from '@tooling/setup/github/governance-mode.js';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the personal ↔ team governance switch.
 *
 * `.github/rulesets/main.json` (merge gate) and `.github/environments/production.json`
 * (production-deploy reviewer gate) carry COUPLED fields: turning on four-eyes
 * review while CODEOWNERS has a single owner, or `preventSelfReview` with a single
 * production reviewer, deadlocks that owner's own PRs / deploys. `pnpm github:tool:governance-mode`
 * flips every coupled field atomically; this test pins the invariant so a hand-edit
 * cannot land the repo in an inconsistent or deadlocking configuration.
 */
const DEFAULT_BRANCH = resolveGitMetadata(loadConfig()).defaultBranch;
const mainRuleset = JSON.parse(
  readFileSync(join(process.cwd(), `.github/rulesets/${DEFAULT_BRANCH}.json`), 'utf-8'),
);
const productionEnvironment = JSON.parse(
  readFileSync(join(process.cwd(), '.github/environments/production.json'), 'utf-8'),
);
const owners = parseCodeownersOwners(
  readFileSync(join(process.cwd(), '.github/CODEOWNERS'), 'utf-8'),
);

describe('committed governance files', () => {
  it('are internally consistent and non-deadlocking', () => {
    const issues = findGovernanceIssues({ mainRuleset, productionEnvironment, owners });
    expect(issues).toEqual([]);
  });

  it('agree on a single recognized mode', () => {
    const rulesetMode = detectRulesetMode(mainRuleset);
    expect(rulesetMode).not.toBe('inconsistent');
    expect(detectProductionMode(productionEnvironment)).toBe(rulesetMode);
  });
});

describe('parseCodeownersOwners', () => {
  it('collects distinct handles in first-seen order, stripping @ and comments', () => {
    const text = ['# comment', '* @alpha @beta', '/src/ @alpha', '', '/docs/ @gamma'].join('\n');
    expect(parseCodeownersOwners(text)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('separates individual users from team slugs', () => {
    expect(codeownerUsers(['alpha', 'core/dev', 'beta'])).toEqual(['alpha', 'beta']);
  });
});

describe('applyGovernanceMode', () => {
  const twoOwnerInputs = {
    mainRuleset,
    productionEnvironment,
    owners: ['alpha', 'beta'],
  };

  it('produces consistent files for both modes and round-trips', () => {
    const team = applyGovernanceMode({ mode: 'team', ...twoOwnerInputs });
    expect(detectRulesetMode(team.mainRuleset)).toBe('team');
    expect(detectProductionMode(team.productionEnvironment)).toBe('team');
    expect(team.reviewers).toEqual(['alpha', 'beta']);
    expect(
      findGovernanceIssues({
        mainRuleset: team.mainRuleset,
        productionEnvironment: team.productionEnvironment,
        owners: twoOwnerInputs.owners,
      }),
    ).toEqual([]);

    const personal = applyGovernanceMode({ mode: 'personal', ...twoOwnerInputs });
    expect(detectRulesetMode(personal.mainRuleset)).toBe('personal');
    expect(detectProductionMode(personal.productionEnvironment)).toBe('personal');
    expect(personal.reviewers).toEqual(['alpha']);
  });

  it('refuses team mode when CODEOWNERS has fewer than two users', () => {
    expect(() =>
      applyGovernanceMode({ mode: 'team', mainRuleset, productionEnvironment, owners: ['alpha'] }),
    ).toThrow(/team mode needs/);
  });

  it('does not mutate the input objects', () => {
    const before = JSON.stringify(mainRuleset);
    applyGovernanceMode({ mode: 'team', ...twoOwnerInputs });
    expect(JSON.stringify(mainRuleset)).toBe(before);
  });
});
