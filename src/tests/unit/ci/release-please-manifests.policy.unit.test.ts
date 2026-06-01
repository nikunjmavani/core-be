import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const RELEASE_PLEASE_DIR = join(ROOT, '.github/release-please');

interface ReleasePleaseConfig {
  prerelease?: boolean;
  'prerelease-type'?: string;
}

interface ReleasePleaseManifest {
  '.': string;
}

function readJson<TValue>(relativePath: string): TValue {
  return JSON.parse(readFileSync(join(RELEASE_PLEASE_DIR, relativePath), 'utf8')) as TValue;
}

describe('release-please manifest policy', () => {
  it('dev config keeps prerelease mode enabled with the `dev` identifier', () => {
    const config = readJson<ReleasePleaseConfig>('config.dev.json');
    expect(config.prerelease).toBe(true);
    expect(config['prerelease-type']).toBe('dev');
  });

  it('dev manifest version ends with `-dev.<n>` while config.dev.json has prerelease enabled', () => {
    const config = readJson<ReleasePleaseConfig>('config.dev.json');
    const manifest = readJson<ReleasePleaseManifest>('manifest.dev.json');
    const devVersion = manifest['.'];

    if (config.prerelease !== true) {
      return;
    }

    expect(
      devVersion,
      `manifest.dev.json must end with -dev.<n> while config.dev.json declares prerelease: true (found "${devVersion}")`,
    ).toMatch(/^\d+\.\d+\.\d+-dev\.\d+$/);
  });

  it('stable config keeps prerelease mode disabled', () => {
    const config = readJson<ReleasePleaseConfig>('config.json');
    expect(config.prerelease ?? false).toBe(false);
  });

  it('stable manifest version is plain MAJOR.MINOR.PATCH (no prerelease suffix)', () => {
    const manifest = readJson<ReleasePleaseManifest>('manifest.json');
    expect(manifest['.']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('stable and dev manifests are not more than one major version apart', () => {
    const stable = readJson<ReleasePleaseManifest>('manifest.json')['.'];
    const dev = readJson<ReleasePleaseManifest>('manifest.dev.json')['.'];

    const stableMajor = Number.parseInt(stable.split('.')[0] ?? '', 10);
    const devMajor = Number.parseInt(dev.split('.')[0] ?? '', 10);

    expect(Number.isFinite(stableMajor)).toBe(true);
    expect(Number.isFinite(devMajor)).toBe(true);
    expect(
      devMajor - stableMajor,
      `dev manifest (${dev}) drifted from stable manifest (${stable}) by more than one major version`,
    ).toBeLessThanOrEqual(1);
    expect(
      devMajor - stableMajor,
      `dev manifest (${dev}) is behind stable manifest (${stable})`,
    ).toBeGreaterThanOrEqual(0);
  });
});
