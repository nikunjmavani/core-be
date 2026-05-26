import { describe, expect, it } from 'vitest';
import {
  getRuntimeEnvironmentEntries,
  validateDeploymentProcessCountSecrets,
} from '../../../../tooling/setup/validate-github-env.js';

describe('validateDeploymentProcessCountSecrets', () => {
  it('returns undefined for environments outside the hosted-deployment set', () => {
    expect(validateDeploymentProcessCountSecrets('test', [])).toBeUndefined();
    expect(validateDeploymentProcessCountSecrets('preview', ['UNRELATED'])).toBeUndefined();
  });

  it('passes when DEPLOYMENT_TOTAL_REPLICA_COUNT shorthand is present', () => {
    expect(
      validateDeploymentProcessCountSecrets('production', [
        'DEPLOYMENT_TOTAL_REPLICA_COUNT',
        'DATABASE_URL',
      ]),
    ).toBeUndefined();
  });

  it('passes when both split counts are present', () => {
    expect(
      validateDeploymentProcessCountSecrets('development', [
        'DEPLOYMENT_API_REPLICA_COUNT',
        'DEPLOYMENT_WORKER_REPLICA_COUNT',
      ]),
    ).toBeUndefined();
  });

  it('reports missing when none of the deployment-count secrets are present', () => {
    expect(validateDeploymentProcessCountSecrets('production', ['DATABASE_URL'])).toEqual({
      kind: 'missing',
    });
    expect(validateDeploymentProcessCountSecrets('development', [])).toEqual({ kind: 'missing' });
  });

  it('reports partial-split when only one split-count secret is present', () => {
    expect(
      validateDeploymentProcessCountSecrets('production', ['DEPLOYMENT_API_REPLICA_COUNT']),
    ).toEqual({ kind: 'partial-split', present: 'API' });

    expect(
      validateDeploymentProcessCountSecrets('production', ['DEPLOYMENT_WORKER_REPLICA_COUNT']),
    ).toEqual({ kind: 'partial-split', present: 'WORKER' });
  });

  it('enforces the rule for development and production environments', () => {
    for (const environment of ['development', 'production']) {
      expect(validateDeploymentProcessCountSecrets(environment, [])).toEqual({ kind: 'missing' });
    }
  });
});

describe('getRuntimeEnvironmentEntries', () => {
  it('treats non-empty runtime environment values as present', () => {
    const entries = getRuntimeEnvironmentEntries({
      DATABASE_URL: 'postgres://example',
      EMPTY_SECRET: '',
      WHITESPACE_VARIABLE: '   ',
      METRICS_ENABLED: 'false',
    });

    expect(entries.allPresent).toEqual(['DATABASE_URL', 'METRICS_ENABLED']);
    expect(entries.variableValues.get('DATABASE_URL')).toBe('postgres://example');
    expect(entries.variableValues.get('METRICS_ENABLED')).toBe('false');
    expect(entries.variableValues.has('EMPTY_SECRET')).toBe(false);
    expect(entries.variableValues.has('WHITESPACE_VARIABLE')).toBe(false);
  });
});
