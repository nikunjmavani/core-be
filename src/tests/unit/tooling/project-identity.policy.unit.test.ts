import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@tooling/setup/common/config.js';
import { buildProjectIdentitySnapshot } from '@tooling/setup/codegen/project-identity.util.js';
import { validateWorkflowLiteralsAgainstManifest } from '@tooling/setup/codegen/validate-project-identity-workflows.js';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

describe('project identity policy', () => {
  it('generated constants match setup.config.json slug', () => {
    const config = loadConfig();
    const constantsPath = resolve(
      repositoryRoot,
      'src/shared/constants/project-identity.constants.ts',
    );
    expect(existsSync(constantsPath)).toBe(true);
    const source = readFileSync(constantsPath, 'utf-8');
    expect(source).toContain(`export const PROJECT_SLUG = '${config.project.name}'`);
  });

  it('composite action contains manifest identity values', () => {
    const config = loadConfig();
    const snapshot = buildProjectIdentitySnapshot(config);
    const actionPath = resolve(repositoryRoot, '.github/actions/setup-project-identity/action.yml');
    expect(existsSync(actionPath)).toBe(true);
    const source = readFileSync(actionPath, 'utf-8');
    expect(source).toContain(`PROJECT_SLUG=${snapshot.slug}`);
    expect(source).toContain(`API_IMAGE=${snapshot.artifacts.apiImage}`);
    expect(source).toContain(`WORKER_IMAGE=${snapshot.artifacts.workerImage}`);
    expect(source).toContain(`GIT_DEFAULT_BRANCH=${snapshot.git.defaultBranch}`);
  });

  it('workflows have no branch or image literals outside the manifest', () => {
    const config = loadConfig();
    const snapshot = buildProjectIdentitySnapshot(config);
    const violations = validateWorkflowLiteralsAgainstManifest({
      snapshot,
      projectRoot: repositoryRoot,
    });
    expect(violations).toEqual([]);
  });

  it('reusable-railway-deploy maps branches from manifest', () => {
    const config = loadConfig();
    const snapshot = buildProjectIdentitySnapshot(config);
    const workflowPath = resolve(repositoryRoot, '.github/workflows/reusable-railway-deploy.yml');
    const workflow = readFileSync(workflowPath, 'utf-8');
    for (const [branch, environment] of Object.entries(snapshot.branchEnvironmentMap)) {
      expect(workflow).toContain(
        `${branch}) echo "environment=${environment}"  >> "$GITHUB_OUTPUT"`,
      );
    }
  });
});
