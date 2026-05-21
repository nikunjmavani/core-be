import { describe, expect, it } from 'vitest';
import { validateDeploymentProcessCountSecrets } from '../../../../tooling/setup/validate-github-env.js';

describe('validateDeploymentProcessCountSecrets', () => {
  it('returns undefined for environments outside the hosted-deployment set', () => {
    expect(validateDeploymentProcessCountSecrets('test', [])).toBeUndefined();
    expect(validateDeploymentProcessCountSecrets('preview', ['UNRELATED'])).toBeUndefined();
  });

  it('passes when DEPLOYMENT_PROCESS_COUNT shorthand is present', () => {
    expect(
      validateDeploymentProcessCountSecrets('production', [
        'DEPLOYMENT_PROCESS_COUNT',
        'DATABASE_URL',
      ]),
    ).toBeUndefined();
  });

  it('passes when both split counts are present', () => {
    expect(
      validateDeploymentProcessCountSecrets('qa', [
        'DEPLOYMENT_API_PROCESS_COUNT',
        'DEPLOYMENT_WORKER_PROCESS_COUNT',
      ]),
    ).toBeUndefined();
  });

  it('reports missing when none of the deployment-count secrets are present', () => {
    expect(validateDeploymentProcessCountSecrets('production', ['DATABASE_URL'])).toEqual({
      kind: 'missing',
    });
    expect(validateDeploymentProcessCountSecrets('dev', [])).toEqual({ kind: 'missing' });
  });

  it('reports partial-split when only one split-count secret is present', () => {
    expect(
      validateDeploymentProcessCountSecrets('production', ['DEPLOYMENT_API_PROCESS_COUNT']),
    ).toEqual({ kind: 'partial-split', present: 'API' });

    expect(
      validateDeploymentProcessCountSecrets('production', ['DEPLOYMENT_WORKER_PROCESS_COUNT']),
    ).toEqual({ kind: 'partial-split', present: 'WORKER' });
  });

  it('enforces the rule for dev, qa, and production environments', () => {
    for (const environment of ['dev', 'qa', 'production']) {
      expect(validateDeploymentProcessCountSecrets(environment, [])).toEqual({ kind: 'missing' });
    }
  });
});
