import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const RELEASE_DEPLOY_WORKFLOW = join(ROOT, '.github/workflows/release-deploy.yml');

// Single-trunk model: production deploys run here on release publication, pinned to
// the release TAG SHA (D7 — immune to the post-merge concurrency queue race), never
// in post-merge-ci.yml (which deploys development only).
describe('release-deploy production policy', () => {
  const workflow = readFileSync(RELEASE_DEPLOY_WORKFLOW, 'utf8');

  it('triggers on release publication (plus manual dispatch for re-deploys)', () => {
    expect(workflow).toMatch(/on:\s*[\s\S]*?release:\s*[\s\S]*?types:\s*\[published\]/);
    expect(workflow).toContain('workflow_dispatch:');
  });

  it('deploys the production environment explicitly (env != branch)', () => {
    expect(workflow).toMatch(/deploy:[\s\S]*?github_environment:\s*production/);
    expect(workflow).toContain('reusable-railway-deploy.yml');
  });

  it('pins everything to the resolved release tag SHA, not github.sha', () => {
    // the tag is resolved and rev-parsed to a SHA that flows into every downstream job
    expect(workflow).toContain('git rev-parse HEAD');
    expect(workflow).toMatch(/merge_commit_sha:\s*\$\{\{\s*needs\.resolve\.outputs\.sha\s*\}\}/);
    // the tag input is validated before it reaches a checkout ref (injection-safe)
    expect(workflow).toMatch(/v\[0-9\]\*\)/);
  });

  it('reuses the scanned tag-sha image (build-once) and only rebuilds when missing', () => {
    expect(workflow).toMatch(
      /image_override:\s*\$\{\{\s*needs\.resolve\.outputs\.api_image\s*\}\}/,
    );
    expect(workflow).toMatch(
      /build-if-missing:[\s\S]*?if:\s*needs\.resolve\.outputs\.image_present != 'true'/,
    );
    expect(workflow).toContain('docker buildx imagetools inspect');
  });

  it('serializes production deploys (no cancel)', () => {
    expect(workflow).toMatch(/concurrency:\s*[\s\S]*?group:\s*release-deploy-production/);
    expect(workflow).toMatch(/cancel-in-progress:\s*false/);
  });
});
