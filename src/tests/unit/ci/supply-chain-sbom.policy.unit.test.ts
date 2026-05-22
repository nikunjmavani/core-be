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

  it('generates CycloneDX SBOM post-merge and attaches it on GitHub Release publish', () => {
    const postMergeWorkflow = readWorkflow('.github/workflows/post-merge-ci.yml');
    expect(postMergeWorkflow).toContain('anchore/sbom-action@v0');
    expect(postMergeWorkflow).toContain('cyclonedx-json');
    expect(postMergeWorkflow).toContain('sbom.cyclonedx.json');

    const releaseSbomWorkflow = readWorkflow('.github/workflows/release-attach-sbom.yml');
    expect(releaseSbomWorkflow).toContain('release:');
    expect(releaseSbomWorkflow).toContain('types: [published]');
    expect(releaseSbomWorkflow).toContain('anchore/sbom-action@v0');
    expect(releaseSbomWorkflow).toContain('softprops/action-gh-release@v2');
    expect(releaseSbomWorkflow).toContain('sbom.cyclonedx.json');
    expect(releaseSbomWorkflow).toContain('github.event.release.tag_name');
  });
});
