import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const RELEASE_PLEASE_DIR = join(ROOT, '.github/release-please');

interface ReleasePleaseConfig {
  draft?: boolean;
  prerelease?: boolean;
  'prerelease-type'?: string;
  versioning?: string;
}

interface ReleasePleaseManifest {
  '.': string;
}

function readJson<TValue>(relativePath: string): TValue {
  return JSON.parse(readFileSync(join(RELEASE_PLEASE_DIR, relativePath), 'utf8')) as TValue;
}

// Single-trunk model (delivery-model migration): release-please runs one stable
// channel on main. The dual-channel `dev` prerelease config/manifest are retired.
describe('release-please manifest policy (single stable channel)', () => {
  it('the retired dev-channel config and manifest are absent', () => {
    expect(existsSync(join(RELEASE_PLEASE_DIR, 'config.dev.json'))).toBe(false);
    expect(existsSync(join(RELEASE_PLEASE_DIR, 'manifest.dev.json'))).toBe(false);
  });

  it('stable config keeps prerelease mode disabled', () => {
    const config = readJson<ReleasePleaseConfig>('config.json');
    expect(config.prerelease ?? false).toBe(false);
  });

  it('stable config does not carry a prerelease identifier or prerelease versioning', () => {
    const config = readJson<ReleasePleaseConfig>('config.json');
    expect(config['prerelease-type']).toBeUndefined();
    expect(config.versioning).not.toBe('prerelease');
  });

  it('stable config publishes releases immediately so release-please does not re-count draft releases', () => {
    const config = readJson<ReleasePleaseConfig>('config.json');
    expect(config.draft ?? false).toBe(false);
  });

  it('stable manifest version is plain MAJOR.MINOR.PATCH (no prerelease suffix)', () => {
    const manifest = readJson<ReleasePleaseManifest>('manifest.json');
    expect(manifest['.']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
