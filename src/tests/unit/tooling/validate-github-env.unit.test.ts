import { describe, expect, it } from 'vitest';
import {
  resolveGitHubEnvironment,
  shouldReportMissingConditional,
  validateDeploymentProcessCountSecrets,
} from '../../../../tooling/setup/github/validate.js';

describe('resolveGitHubEnvironment', () => {
  it('maps deploy aliases to canonical GitHub Environment names', () => {
    expect(resolveGitHubEnvironment('dev')).toBe('development');
    expect(resolveGitHubEnvironment('development')).toBe('development');
    expect(resolveGitHubEnvironment('prod')).toBe('production');
    expect(resolveGitHubEnvironment('production')).toBe('production');
  });

  it('leaves custom environment names unchanged', () => {
    expect(resolveGitHubEnvironment('staging')).toBe('staging');
  });
});

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

describe('shouldReportMissingConditional', () => {
  describe('CAPTCHA_SECRET', () => {
    const entry = { key: 'CAPTCHA_SECRET' };

    it('warns when CAPTCHA_PROVIDER=turnstile', () => {
      const variableValues = new Map([['CAPTCHA_PROVIDER', 'turnstile']]);
      expect(shouldReportMissingConditional(entry, 'production', variableValues)).toBe(true);
    });

    it('does not warn when CAPTCHA_PROVIDER=disabled', () => {
      const variableValues = new Map([['CAPTCHA_PROVIDER', 'disabled']]);
      expect(shouldReportMissingConditional(entry, 'production', variableValues)).toBe(false);
    });

    it('does not warn when CAPTCHA_PROVIDER is unset (schema default is disabled)', () => {
      expect(shouldReportMissingConditional(entry, 'production', new Map())).toBe(false);
    });
  });

  describe('METRICS_SCRAPE_TOKEN', () => {
    const entry = { key: 'METRICS_SCRAPE_TOKEN' };

    it('warns when METRICS_ENABLED is unset (schema default is true)', () => {
      expect(shouldReportMissingConditional(entry, 'production', new Map())).toBe(true);
    });

    it('does not warn when METRICS_ENABLED=false', () => {
      const variableValues = new Map([['METRICS_ENABLED', 'false']]);
      expect(shouldReportMissingConditional(entry, 'production', variableValues)).toBe(false);
    });

    it('does not warn when METRICS_ENABLED=0', () => {
      const variableValues = new Map([['METRICS_ENABLED', '0']]);
      expect(shouldReportMissingConditional(entry, 'production', variableValues)).toBe(false);
    });
  });

  describe('CAPTCHA_DISABLED_ACK', () => {
    const entry = { key: 'CAPTCHA_DISABLED_ACK' };

    it('does not warn outside production', () => {
      expect(shouldReportMissingConditional(entry, 'development', new Map())).toBe(false);
      expect(
        shouldReportMissingConditional(
          entry,
          'development',
          new Map([['CAPTCHA_PROVIDER', 'disabled']]),
        ),
      ).toBe(false);
    });

    it('warns in production when CAPTCHA_PROVIDER is unset (defaults to disabled)', () => {
      expect(shouldReportMissingConditional(entry, 'production', new Map())).toBe(true);
    });

    it('warns in production when CAPTCHA_PROVIDER=disabled', () => {
      const variableValues = new Map([['CAPTCHA_PROVIDER', 'disabled']]);
      expect(shouldReportMissingConditional(entry, 'production', variableValues)).toBe(true);
    });

    it('does not warn in production when CAPTCHA_PROVIDER=turnstile (ack irrelevant)', () => {
      const variableValues = new Map([['CAPTCHA_PROVIDER', 'turnstile']]);
      expect(shouldReportMissingConditional(entry, 'production', variableValues)).toBe(false);
    });
  });

  it('warns by default for keys without explicit gating', () => {
    const entry = { key: 'SOME_UNKNOWN_KEY' };
    expect(shouldReportMissingConditional(entry, 'production', new Map())).toBe(true);
  });
});
