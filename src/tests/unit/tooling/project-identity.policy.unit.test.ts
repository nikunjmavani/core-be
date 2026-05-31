import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../../tooling/setup/common/config.js';
import { buildProjectIdentitySnapshot } from '../../../../tooling/setup/codegen/project-identity.util.js';

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

  it('sync.config.json matches manifest environments', () => {
    const config = loadConfig();
    const snapshot = buildProjectIdentitySnapshot(config);
    const syncConfigPath = resolve(repositoryRoot, '.github/sync.config.json');
    const expected = `${JSON.stringify(
      {
        environments: snapshot.environments.map((environment) => ({
          name: environment.name,
          branch: environment.branch,
        })),
      },
      null,
      2,
    )}\n`;
    expect(readFileSync(syncConfigPath, 'utf-8')).toBe(expected);
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
