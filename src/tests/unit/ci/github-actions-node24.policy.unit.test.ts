import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const WORKFLOWS_DIR = join(ROOT, '.github/workflows');

const DEPRECATED_ACTION_PATTERNS = [
  /actions\/checkout@v[1-5]\b/,
  /actions\/setup-node@v[1-5]\b/,
  /pnpm\/action-setup@v[1-5]\b/,
  /actions\/cache@v[1-4]\b/,
  /actions\/upload-artifact@v[1-6]\b/,
  /actions\/download-artifact@v[1-7]\b/,
  /actions\/github-script@v[1-8]\b/,
  /actions\/labeler@v[1-5]\b/,
  /googleapis\/release-please-action@v[1-4]\b/,
  /softprops\/action-gh-release@v[12]\b/,
  /amannn\/action-semantic-pull-request@v[1-5]\b/,
  /docker\/login-action@v[1-3]\b/,
  /DavidAnson\/markdownlint-cli2-action@v(1[0-9]|2[0-2])\b/,
  /anchore\/sbom-action@v0\b(?!\.)/,
] as const;

function listWorkflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
    .map((fileName) => join(WORKFLOWS_DIR, fileName));
}

describe('GitHub Actions Node.js 24 policy', () => {
  it('sets FORCE_JAVASCRIPT_ACTIONS_TO_NODE24 on every workflow', () => {
    for (const workflowPath of listWorkflowFiles()) {
      const contents = readFileSync(workflowPath, 'utf8');
      expect(contents, workflowPath).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true');
    }
  });

  it('does not pin deprecated Node 20-era action major versions', () => {
    for (const workflowPath of listWorkflowFiles()) {
      const contents = readFileSync(workflowPath, 'utf8');
      for (const pattern of DEPRECATED_ACTION_PATTERNS) {
        expect(contents, `${workflowPath} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('does not use secrets: inherit under on.workflow_call (caller-only keyword)', () => {
    for (const workflowPath of listWorkflowFiles()) {
      const contents = readFileSync(workflowPath, 'utf8');
      expect(contents, workflowPath).not.toMatch(/workflow_call:\s*\n\s*secrets:\s*inherit/);
    }
  });

  it('installs project Node from .nvmrc via setup-node v6 composite', () => {
    const setupNodePnpm = readFileSync(
      join(ROOT, '.github/actions/setup-node-pnpm/action.yml'),
      'utf8',
    );
    expect(setupNodePnpm).toContain('pnpm/action-setup@v6');
    expect(setupNodePnpm).toContain('actions/setup-node@v6');
    expect(setupNodePnpm).toContain('node-version-file: .nvmrc');
  });
});
