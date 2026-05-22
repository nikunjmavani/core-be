import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readWorkflow(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('supply chain SBOM policy (#94 p3-sbom-syft)', () => {
  it('runs pnpm audit in ci:quality via deps:audit', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['deps:audit']).toBe('pnpm audit');
    expect(packageJson.scripts['deps:audit:prod']).toBe('pnpm audit --prod');
    expect(packageJson.scripts['ci:quality']).toMatch(/pnpm deps:audit/);
  });

  it('runs dependency audit in the quality-static reusable workflow', () => {
    const qualityStatic = readWorkflow('.github/workflows/reusable-quality-static.yml');
    expect(qualityStatic).toContain('pnpm deps:audit');
    expect(qualityStatic).toContain('pnpm deps:audit:prod');
  });

  it('generates CycloneDX SBOM in CI and attaches it on GitHub Release publish', () => {
    const ciWorkflow = readWorkflow('.github/workflows/pr-branch-ci.yml');
    expect(ciWorkflow).toContain('anchore/sbom-action@v0');
    expect(ciWorkflow).toContain('cyclonedx-json');
    expect(ciWorkflow).toContain('sbom.cyclonedx.json');

    const releaseSbomWorkflow = readWorkflow('.github/workflows/release-sbom.yml');
    expect(releaseSbomWorkflow).toContain('release:');
    expect(releaseSbomWorkflow).toContain('types: [published]');
    expect(releaseSbomWorkflow).toContain('anchore/sbom-action@v0');
    expect(releaseSbomWorkflow).toContain('softprops/action-gh-release@v2');
    expect(releaseSbomWorkflow).toContain('sbom.cyclonedx.json');
    expect(releaseSbomWorkflow).toContain('github.event.release.tag_name');
  });
});
