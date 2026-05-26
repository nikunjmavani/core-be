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

  it('runs dependency audit in the PR CI security-scan job', () => {
    const prCi = readWorkflow('.github/workflows/pr-ci.yml');
    expect(prCi).toContain('pnpm deps:audit');
    expect(prCi).toContain('pnpm deps:audit:prod');
  });

  it('generates CycloneDX SBOM post-merge and attaches it when release-please publishes', () => {
    const postMergeWorkflow = readWorkflow('.github/workflows/post-merge-ci.yml');
    expect(postMergeWorkflow).toContain('anchore/sbom-action@v0.24.0');
    expect(postMergeWorkflow).toContain('cyclonedx-json');
    expect(postMergeWorkflow).toContain('sbom.cyclonedx.json');
    expect(postMergeWorkflow).toContain('release-sbom');
    expect(postMergeWorkflow).toContain('softprops/action-gh-release@v3');
    expect(postMergeWorkflow).toContain('Release SBOM');
  });
});
