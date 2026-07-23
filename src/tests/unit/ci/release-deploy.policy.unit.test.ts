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

  it('retags the deployed image as :vX.Y.Z only after a successful production deploy', () => {
    // The retag job gates on deploy success, so the version tag never points at a build that
    // failed to deploy; it retags via imagetools (same manifest, no pull), api + worker.
    expect(workflow).toMatch(/retag:[\s\S]*?needs:\s*\[resolve,\s*deploy\]/);
    expect(workflow).toMatch(/retag:[\s\S]*?if:\s*success\(\)/);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell variable in the workflow YAML — not a TS template.
    expect(workflow).toContain('docker buildx imagetools create --tag "${api_base}:${TAG}"');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell variable in the workflow YAML — not a TS template.
    expect(workflow).toContain('docker buildx imagetools create --tag "${worker_base}:${TAG}"');
  });
});

// The reusable deploy serializes per ENVIRONMENT (single-trunk: env != branch). The
// concurrency group is keyed on the environment ONLY (no sha), so two dispatches of different
// shas to the same Railway environment queue instead of racing on the live service.
describe('reusable railway deploy concurrency', () => {
  const reusable = readFileSync(
    join(ROOT, '.github/workflows/reusable-railway-deploy.yml'),
    'utf8',
  );

  it('keys the concurrency group on the environment only — never the sha', () => {
    expect(reusable).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression in the workflow YAML — not a TS template.
      "group: railway-deploy-${{ inputs.github_environment || inputs.target || 'deploy' }}",
    );
    // no sha suffix on the group (would let different-sha deploys to one environment race)
    expect(reusable).not.toMatch(/railway-deploy-\$\{\{[^\n]*\}\}-\$\{\{/);
    expect(reusable).toContain('cancel-in-progress: false');
  });
});
