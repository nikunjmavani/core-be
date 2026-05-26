import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const POST_MERGE_WORKFLOW = join(ROOT, '.github/workflows/post-merge-ci.yml');

describe('post-merge CI trigger policy', () => {
  it('runs only on pushes to dev/main (plus manual dispatch)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toContain('push:');
    expect(workflow).toContain('branches: [main, dev]');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('pull_request:');
  });

  it('does not run chaos matrix in post-merge CI', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).not.toContain('reusable-chaos-toxiproxy.yml');
    expect(workflow).not.toMatch(/^\s+chaos:/m);
  });

  it('does not run sync-main-into-dev (manual sync only when needed)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).not.toMatch(/^\s+sync-main-into-dev:/m);
    expect(workflow).not.toContain('Sync main into dev');
  });

  it('runs docker before matrix tests, then release-please, then resolve-environment/deploy', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toMatch(/matrix-tests:[\s\S]*?needs:\s*\[changes,\s*docker-build-push\]/);
    expect(workflow).toMatch(/matrix-tests:[\s\S]*?reusable-vitest-postgres-redis\.yml/);
    expect(workflow).toMatch(/release-please:[\s\S]*?needs:\s*\[matrix-tests,\s*sbom\]/);
    expect(workflow).toMatch(/attach-release-sbom:[\s\S]*?needs:\s*\[sbom,\s*release-please\]/);
    expect(workflow).not.toMatch(/resolve-environment:[\s\S]*?- attach-release-sbom/);
    expect(workflow).toMatch(/deploy:[\s\S]*?needs:\s*[\s\S]*-\s*resolve-environment/);
  });

  it('reuses sbom artifact for release-sbom (no duplicate generation)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toContain('Download SBOM artifact from sbom job');
    expect(workflow).toMatch(/attach-release-sbom:[\s\S]*?actions\/download-artifact@v8/);
  });
});
