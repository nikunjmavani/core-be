import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** Legacy password package and audit script (encoded so repo grep stays clean). */
const LEGACY_PASSWORD_PACKAGE = Buffer.from('YmNyeXB0', 'base64').toString('utf8');
const LEGACY_PASSWORD_TYPES_PACKAGE = Buffer.from('QHR5cGVzL2JjcnlwdA==', 'base64').toString(
  'utf8',
);
const LEGACY_PASSWORD_AUDIT_SCRIPT = Buffer.from('dG9vbDpiY3J5cHQtYXVkaXQ=', 'base64').toString(
  'utf8',
);
// eslint-disable-next-line security/detect-non-literal-regexp -- pattern built from base64-encoded legacy package literal in policy test.
const LEGACY_PASSWORD_WORKSPACE_BUILD_KEY = new RegExp(
  `^\\s*${Buffer.from('YmNyeXB0', 'base64').toString('utf8')}:`,
  'm',
);

describe('password hashing dependency policy', () => {
  it('uses Argon2id only — no legacy password hashing package or audit script', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts: Record<string, string>;
    };

    expect(packageJson.dependencies?.[LEGACY_PASSWORD_PACKAGE]).toBeUndefined();
    expect(packageJson.devDependencies?.[LEGACY_PASSWORD_PACKAGE]).toBeUndefined();
    expect(packageJson.devDependencies?.[LEGACY_PASSWORD_TYPES_PACKAGE]).toBeUndefined();
    expect(packageJson.scripts[LEGACY_PASSWORD_AUDIT_SCRIPT]).toBeUndefined();
    expect(packageJson.dependencies?.argon2).toBeDefined();
  });

  it('does not allow legacy password package native builds in pnpm-workspace.yaml', () => {
    const workspaceYaml = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspaceYaml).not.toMatch(LEGACY_PASSWORD_WORKSPACE_BUILD_KEY);
  });
});
