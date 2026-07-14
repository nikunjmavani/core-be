import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCRIPT = readFileSync(join(ROOT, 'tooling/dev/setup-mac-tools.sh'), 'utf8');
const SETUP_LOCAL = readFileSync(join(ROOT, 'tooling/dev/setup-local.ts'), 'utf8');
const PACKAGE_JSON = readFileSync(join(ROOT, 'package.json'), 'utf8');

/**
 * Guards the macOS external-tool installer used by `pnpm setup:local`: it must
 * install/upgrade every non-npm tool the project needs from AUTHENTICATED sources
 * only, NON-INTERACTIVELY (no pause), macOS-gated, and be wired into setup:local
 * with a dry-run (`--check`) path and a skip flag.
 */
describe('setup:local macOS external-tool installer policy', () => {
  it('is macOS-gated and offers a --check dry-run', () => {
    expect(SCRIPT).toContain('uname -s');
    expect(SCRIPT).toContain('Darwin');
    expect(SCRIPT).toMatch(/--check\s*\|\s*--dry-run/);
  });

  it('bootstraps Homebrew non-interactively from the official source', () => {
    expect(SCRIPT).toContain('NONINTERACTIVE=1');
    expect(SCRIPT).toContain('raw.githubusercontent.com/Homebrew/install/HEAD/install.sh');
    // no confirmation prompts / env hints
    expect(SCRIPT).toContain('HOMEBREW_NO_AUTO_UPDATE=1');
  });

  it('installs the expected tools from authenticated sources', () => {
    for (const formula of ['gitleaks', 'gh', 'jq', 'uv', 'pipx', 'colima']) {
      expect(SCRIPT).toContain(formula);
    }
    // codegraph via the npm registry; headroom via PyPI through pipx
    expect(SCRIPT).toContain('npm install -g @colbymchenry/codegraph@latest');
    expect(SCRIPT).toContain("pipx install 'headroom-ai[mcp]'");
    // Node matches the pinned .nvmrc major
    expect(SCRIPT).toContain('.nvmrc');
  });

  it('upgrades tools that are already installed (not just install-if-missing)', () => {
    expect(SCRIPT).toContain('brew upgrade');
    expect(SCRIPT).toContain('pipx upgrade');
    expect(SCRIPT).toContain('@latest');
  });

  it('is wired into setup:local: darwin-gated, skippable, and passes --check through', () => {
    expect(SETUP_LOCAL).toContain("process.platform === 'darwin'");
    expect(SETUP_LOCAL).toContain('options.skipMacTools');
    expect(SETUP_LOCAL).toContain('tooling/dev/setup-mac-tools.sh');
    expect(SETUP_LOCAL).toContain("has('--skip-mac-tools')");
  });

  it('exposes a standalone pnpm setup:mac-tools script', () => {
    expect(PACKAGE_JSON).toContain('"setup:mac-tools": "bash tooling/dev/setup-mac-tools.sh"');
  });
});
