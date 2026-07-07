import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@tooling/setup/common/config.js';
import { resolveGitMetadata } from '@tooling/setup/codegen/project-identity.util.js';

const ROOT = process.cwd();
const POST_MERGE_WORKFLOW = join(ROOT, '.github/workflows/post-merge-ci.yml');

describe('post-merge CI trigger policy', () => {
  it('runs only on pushes to the protected branch (plus manual dispatch)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    const protectedBranches = resolveGitMetadata(loadConfig()).protectedBranches.join(', ');
    expect(workflow).toContain('push:');
    expect(workflow).toContain(`branches: [${protectedBranches}]`);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toContain('pull_request:');
  });

  it('does not run chaos matrix in post-merge CI', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).not.toContain('reusable-chaos-toxiproxy.yml');
    expect(workflow).not.toMatch(/^\s+chaos:/m);
  });

  it('has no dev-branch automation (single trunk): no back-merge, no ancestry, no channel suffix', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).not.toMatch(/^\s+sync-main-into-dev:/m);
    expect(workflow).not.toContain('Sync main into dev');
    expect(workflow).not.toMatch(/^\s+dispatch-post-release-backmerge:/m);
    expect(workflow).not.toContain('post-release-backmerge');
    expect(workflow).not.toContain('CHANNEL_SUFFIX');
  });

  it('un-serializes the matrix from the docker build and gates it on the FULL lane (adaptive lanes)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    // matrix depends only on `changes` (its own PG/Redis services, never the image)
    expect(workflow).toMatch(/matrix-tests:[\s\S]*?needs:\s*\[changes\]/);
    expect(workflow).not.toMatch(
      /matrix-tests:[\s\S]*?needs:\s*\[changes,\s*sbom,\s*docker-build-push\]/,
    );
    // matrix runs only in the FULL lane (single-PR pushes trust the authoritative PR gate)
    expect(workflow).toMatch(/matrix-tests:[\s\S]*?needs\.changes\.outputs\.full-lane == 'true'/);
    expect(workflow).toMatch(/matrix-tests:[\s\S]*?reusable-vitest-postgres-redis\.yml/);
    // lane is computed from the commit count in the push
    expect(workflow).toContain('full_lane');
    expect(workflow).toContain('git rev-list --count');
  });

  it('release-please gates on tests, reads the PAT via the development environment, and is NOT auto-merged', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toMatch(/release-please:[\s\S]*?needs:\s*\[matrix-tests\]/);
    // D2: the PAT is read from the unprotected development environment
    expect(workflow).toMatch(/release-please:[\s\S]*?environment:\s*development/);
    expect(workflow).toMatch(/config-file:\s*\.github\/release-please\/config\.json/);
    expect(workflow).toMatch(/manifest-file:\s*\.github\/release-please\/manifest\.json/);
    // D1: the Release PR is the manual ship button — never auto-merged
    expect(workflow).not.toMatch(/gh pr merge .*--auto/);
  });

  it('deploys the development environment only (production deploys move to release-deploy.yml)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toMatch(/deploy:[\s\S]*?github_environment:\s*development/);
    expect(workflow).toMatch(/deploy:[\s\S]*?needs:\s*[\s\S]*-\s*docker-build-push/);
    expect(workflow).toMatch(/deploy:[\s\S]*?needs:\s*[\s\S]*-\s*api-docs/);
    // no branch-derived environment resolution in this workflow anymore
    expect(workflow).not.toMatch(/^\s+resolve-environment:/m);
  });

  it('publishes API docs independently of release-please (a release-please failure must not skip Scalar/Postman publishing)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    const apiDocsBlock =
      workflow.match(/^ {2}api-docs:\n([\s\S]*?)\n {2}release-please:/m)?.[1] ?? '';
    expect(apiDocsBlock).not.toBe('');
    expect(apiDocsBlock).toMatch(/needs:\s*\[changes\]/);
    expect(apiDocsBlock).not.toMatch(/needs\.release-please\.result/);
    expect(apiDocsBlock).toContain('reusable-openapi-postman-publish.yml');
  });

  it('reuses sbom artifact for release-sbom (no duplicate generation)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toContain('Download SBOM artifact from sbom job');
    expect(workflow).toMatch(/release-sbom:[\s\S]*?actions\/download-artifact@[0-9a-f]{40}/);
    // resolved by the exact release-please tag_name output (no gh release list scan)
    expect(workflow).toMatch(/release-sbom:[\s\S]*?needs\.release-please\.outputs\.tag_name/);
  });

  it('does not publish draft stable releases after deploy', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).not.toMatch(/^ {2}publish-release:/m);
    expect(workflow).not.toContain('gh release edit');
    expect(workflow).not.toContain('--draft=false');
  });
});
