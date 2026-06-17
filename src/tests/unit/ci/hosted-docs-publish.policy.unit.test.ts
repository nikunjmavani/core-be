import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PUBLISH_WORKFLOW = join(ROOT, '.github/workflows/reusable-openapi-postman-publish.yml');

describe('hosted docs publish policy (Postman + Scalar Registry)', () => {
  it('gates uploads on the publish_hosted_docs input only, never a step-level secret env', () => {
    const workflow = readFileSync(PUBLISH_WORKFLOW, 'utf8');
    // GitHub does not populate a step's own env before evaluating that step's `if:`, so gating
    // on env.SCALAR_API_KEY / env.POSTMAN_API_KEY skips the step even when the secrets are set.
    // Credential presence is decided inside the upload scripts (shouldSkipHostedUpload) instead.
    expect(workflow).not.toMatch(/if:\s*inputs\.publish_hosted_docs\s*&&\s*env\./);
    expect(workflow).not.toContain("env.SCALAR_API_KEY != ''");
    expect(workflow).not.toContain("env.POSTMAN_API_KEY != ''");
  });

  it('runs both the Postman and Scalar Registry upload scripts as best-effort steps', () => {
    const workflow = readFileSync(PUBLISH_WORKFLOW, 'utf8');
    expect(workflow).toContain('pnpm docs:upload');
    expect(workflow).toContain('pnpm docs:upload:scalar');

    const scalarStep =
      workflow.match(
        /- name: Upload OpenAPI to Scalar Registry\n([\s\S]*?)run: pnpm docs:upload:scalar/,
      )?.[1] ?? '';
    expect(scalarStep).not.toBe('');
    expect(scalarStep).toContain('if: inputs.publish_hosted_docs');
    // best-effort: an external registry hiccup must never block the post-merge deploy.
    expect(scalarStep).toContain('continue-on-error: true');
    // the Scalar API key is wired into the step from the GitHub Environment secret.
    expect(scalarStep).toContain('SCALAR_API_KEY:');
    expect(scalarStep).toContain('secrets.SCALAR_API_KEY');
    // namespace/slug are non-sensitive registry identifiers → read from Variables, not Secrets.
    expect(scalarStep).toContain('vars.SCALAR_NAMESPACE');
    expect(scalarStep).not.toContain('secrets.SCALAR_NAMESPACE');
  });
});
