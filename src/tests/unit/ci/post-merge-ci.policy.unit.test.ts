import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@tooling/setup/common/config.js';
import { resolveGitMetadata } from '@tooling/setup/codegen/project-identity.util.js';

const ROOT = process.cwd();
const POST_MERGE_WORKFLOW = join(ROOT, '.github/workflows/post-merge-ci.yml');

describe('post-merge CI trigger policy', () => {
  it('runs only on pushes to dev/main (plus manual dispatch)', () => {
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

  it('does not run sync-main-into-dev (manual sync only when needed)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).not.toMatch(/^\s+sync-main-into-dev:/m);
    expect(workflow).not.toContain('Sync main into dev');
  });

  it('runs matrix tests after sbom+docker, then deploys after docs, release sbom, and docker', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toMatch(
      /matrix-tests:[\s\S]*?needs:\s*\[changes,\s*sbom,\s*docker-build-push\]/,
    );
    expect(workflow).toMatch(/matrix-tests:[\s\S]*?reusable-vitest-postgres-redis\.yml/);
    expect(workflow).toMatch(/release-please:[\s\S]*?needs:\s*\[matrix-tests\]/);
    expect(workflow).toMatch(/release-sbom:[\s\S]*?needs:\s*\[sbom,\s*release-please\]/);
    expect(workflow).not.toMatch(/^\s+resolve-environment:/m);
    expect(workflow).toMatch(/deploy:[\s\S]*?needs:\s*[\s\S]*-\s*docker-build-push/);
    expect(workflow).toMatch(/deploy:[\s\S]*?needs:\s*[\s\S]*-\s*api-docs/);
    expect(workflow).toMatch(/deploy:[\s\S]*?needs:\s*[\s\S]*-\s*release-sbom/);
  });

  it('publishes API docs independently of release-please (a release-please failure must not skip Scalar/Postman publishing)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    const apiDocsBlock =
      workflow.match(/^ {2}api-docs:\n([\s\S]*?)\n {2}release-please:/m)?.[1] ?? '';
    expect(apiDocsBlock).not.toBe('');
    // api-docs must not depend on the release-please job result …
    expect(apiDocsBlock).toMatch(/needs:\s*\[changes\]/);
    expect(apiDocsBlock).not.toMatch(/needs\.release-please\.result/);
    // … and still publishes via the reusable docs workflow.
    expect(apiDocsBlock).toContain('reusable-openapi-postman-publish.yml');
  });

  it('reuses sbom artifact for release-sbom (no duplicate generation)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toContain('Download SBOM artifact from sbom job');
    expect(workflow).toMatch(/release-sbom:[\s\S]*?actions\/download-artifact@[0-9a-f]{40}/);
  });
});
