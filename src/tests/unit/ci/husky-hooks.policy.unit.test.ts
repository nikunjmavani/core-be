import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Locks the local git-hook chain — this repository's first line of defence, and until now
 * untested.
 *
 * The hooks are the only gate that runs before a push reaches CI, and they are plain shell: a
 * deleted line stops enforcing silently, with no error and nothing in CI to notice. That is not
 * hypothetical here — the pre-commit guard's step list encodes real policy decisions (the
 * SonarQube gate is conditional on deployed-surface files; the branch-name check has exactly one
 * documented bypass), and a quiet edit to any of them changes what can reach main.
 *
 * Ported from the sibling frontend repository's `husky-hooks.policy` suite, which this
 * repository had no equivalent of.
 */

const ROOT = process.cwd();
const hook = (name: string): string => readFileSync(join(ROOT, '.husky', name), 'utf8');

describe('husky hook inventory', () => {
  it('ships every hook the workflow docs rely on', () => {
    const hooks = readdirSync(join(ROOT, '.husky')).filter((entry) => !entry.startsWith('_'));

    for (const required of [
      'pre-commit',
      'pre-push',
      'commit-msg',
      'post-merge',
      'post-checkout',
    ]) {
      expect(hooks, `.husky/${required} is missing`).toContain(required);
    }
  });
});

describe('pre-commit hook', () => {
  const preCommit = hook('pre-commit');

  it('delegates to the single guard orchestrator', () => {
    // One entry point keeps the step list reviewable in TypeScript rather than sprawling shell.
    expect(preCommit).toContain('pnpm guard:pre-commit');
  });
});

describe('pre-push hook', () => {
  const prePush = hook('pre-push');

  it('enforces the <type>/<short-description> branch-name policy', () => {
    expect(prePush).toContain('BRANCH_TYPES=');
    for (const type of ['feat', 'fix', 'hotfix', 'refactor', 'docs', 'test', 'chore', 'ci']) {
      expect(prePush, `BRANCH_TYPES must include ${type}`).toContain(type);
    }
  });

  it('allowlists claude/* web-session branches', () => {
    // The cloud git proxy pins a web session to pushing only its own claude/* branch.
    expect(prePush).toContain('claude/');
  });

  it('keeps exactly one documented branch-check bypass', () => {
    expect(prePush).toContain('SKIP_BRANCH_CHECK');
  });

  it('resolves the trunk from config rather than hardcoding a branch name', () => {
    // A renamed trunk must stay exempt without editing the hook.
    expect(prePush).toContain('setup.config.json');
    expect(prePush).toContain('defaultBranch');
  });

  it('exempts a detached HEAD from the branch-name check', () => {
    expect(prePush).toContain('"HEAD"');
  });

  it.each([
    ['pnpm typecheck', 'typecheck'],
    ['pnpm build', 'build'],
    ['pnpm build:check', 'alias-free dist check'],
  ])('runs %s before the push lands', (command) => {
    expect(prePush).toContain(command);
  });

  it('checks generated-doc drift so a --no-verify commit cannot ship stale artifacts', () => {
    // pre-commit REGENERATES these; pre-push only verifies, which is the net for commits made
    // with --no-verify where the regeneration steps never ran.
    expect(prePush).toContain('pnpm tool:project-structure-tree:check');
    expect(prePush).toContain('pnpm routes:catalog:check');
    expect(prePush).toContain('pnpm validate:route-org-scope');
  });

  it('runs the unit lane, scoped to unit-relevant changes', () => {
    expect(prePush).toContain('pnpm test:unit');
    expect(prePush).toContain('PUSHED_UNIT_RELEVANT');
  });

  it('uses POSIX grep so a machine without ripgrep still gates', () => {
    // A rg-dependent hook silently no-ops its file filters where rg is absent.
    expect(prePush).toContain('grep -E');
    expect(prePush).not.toMatch(/^\s*rg\s/m);
  });

  it('falls back to origin/main when the branch has no upstream yet', () => {
    // Without the fallback the first push of a new branch diffs against nothing and every
    // conditional gate is skipped.
    expect(prePush).toContain('origin/main');
  });
});

describe('commit-msg hook', () => {
  it('enforces conventional commits via commitlint', () => {
    // release-please derives the version bump from the commit type, so a malformed subject
    // silently breaks releases rather than failing loudly.
    expect(hook('commit-msg')).toContain('commitlint');
  });
});
