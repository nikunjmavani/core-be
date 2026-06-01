import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const BACKMERGE_WORKFLOW = join(ROOT, '.github/workflows/post-release-backmerge.yml');

describe('post-release back-merge workflow policy', () => {
  it('triggers on release.published and on manual workflow_dispatch only', () => {
    const workflow = readFileSync(BACKMERGE_WORKFLOW, 'utf8');
    expect(workflow).toContain('release:');
    expect(workflow).toContain('types: [published]');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('pull_request:');
    expect(workflow).not.toMatch(/^on:\s*\n\s*push:/m);
  });

  it('filters out prerelease events so dev `-dev.N` tags do not fire it', () => {
    const workflow = readFileSync(BACKMERGE_WORKFLOW, 'utf8');
    expect(workflow).toContain('github.event.release.prerelease == false');
    expect(workflow).toContain("!contains(github.event.release.tag_name, '-dev.')");
  });

  it('uses the built-in github.token with minimal write permissions', () => {
    const workflow = readFileSync(BACKMERGE_WORKFLOW, 'utf8');
    expect(workflow).toMatch(/permissions:[\s\S]*?contents:\s*write/);
    expect(workflow).toMatch(/permissions:[\s\S]*?pull-requests:\s*write/);
    expect(workflow).not.toMatch(/permissions:[\s\S]*?packages:\s*write/);
    expect(workflow).not.toMatch(/permissions:[\s\S]*?id-token:\s*write/);
    expect(workflow).toMatch(/token:\s*\$\{\{\s*github\.token\s*\}\}/);
    expect(workflow).toMatch(/GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
    expect(workflow).not.toMatch(/secrets\.GITHUB_PAT|secrets\.PERSONAL_ACCESS_TOKEN/i);
  });

  it('only edits manifest.dev.json (no other release files or sources touched)', () => {
    const workflow = readFileSync(BACKMERGE_WORKFLOW, 'utf8');
    const gitAddMatches = workflow.match(/git add (?:--[A-Za-z-]+ )*(\S+)/g) ?? [];
    expect(gitAddMatches.length).toBeGreaterThan(0);
    for (const match of gitAddMatches) {
      expect(match, `unexpected file added by back-merge workflow: ${match}`).toMatch(
        /manifest\.dev\.json$/,
      );
    }
    expect(workflow).not.toMatch(/git add\s+.*manifest\.json[^.]/);
    expect(workflow).not.toMatch(/git add\s+.*package\.json/);
    expect(workflow).not.toMatch(/git add\s+.*CHANGELOG/);
  });

  it('checks out dev, merges main into the back-merge branch, and pushes a branch named release/backmerge-v<version>', () => {
    const workflow = readFileSync(BACKMERGE_WORKFLOW, 'utf8');
    expect(workflow).toMatch(/ref:\s*dev/);
    expect(workflow).toContain('git fetch origin main');
    expect(workflow).toMatch(/git merge[^\n]*origin\/main/);
    expect(workflow).toMatch(/branch="release\/backmerge-v\$\{VERSION\}"/);
    expect(workflow).toMatch(/git push origin "\$\{branch\}"/);
  });

  it('opens a PR to dev and enables auto-merge (idempotent)', () => {
    const workflow = readFileSync(BACKMERGE_WORKFLOW, 'utf8');
    expect(workflow).toMatch(/gh pr create[\s\S]*?--base dev/);
    expect(workflow).toMatch(/gh pr merge[^\n]*--auto[^\n]*--squash/);
    expect(workflow).toMatch(/gh pr list[\s\S]*?--head "\$\{BRANCH\}"[\s\S]*?--base dev/);
  });

  it('declares concurrency so simultaneous release events queue instead of racing', () => {
    const workflow = readFileSync(BACKMERGE_WORKFLOW, 'utf8');
    expect(workflow).toMatch(/concurrency:\s*\n\s*group:\s*post-release-backmerge-/);
    expect(workflow).toMatch(/cancel-in-progress:\s*false/);
  });
});
