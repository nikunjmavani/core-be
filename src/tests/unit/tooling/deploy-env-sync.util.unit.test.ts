import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getRailwayExcludeRegex,
  isRailwaySyncSchemaDriven,
  metricsDeploySyncHasErrors,
  metricsEnvironmentVariableNames,
  validateMetricsDeploySync,
} from '../../../../tooling/setup/github/deploy-sync.js';

const DEPLOY_WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../../.github/workflows/reusable-railway-deploy.yml',
);

describe('deploy-env-sync.util', () => {
  it('lists METRICS_* keys from env schema', () => {
    const names = metricsEnvironmentVariableNames();
    expect(names).toContain('METRICS_ENABLED');
    expect(names).toContain('METRICS_SCRAPE_TOKEN');
    expect(names.every((name) => name.startsWith('METRICS_'))).toBe(true);
  });

  it('deploy workflow uses schema-driven Railway sync (toJSON(secrets) + toJSON(vars))', () => {
    const workflowContent = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8');
    expect(isRailwaySyncSchemaDriven(workflowContent)).toBe(true);
  });

  it('deploy workflow exclude_regex skips infra/CI keys but not METRICS_*', () => {
    const workflowContent = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8');
    const excludeRegex = getRailwayExcludeRegex(workflowContent);
    expect(excludeRegex).not.toBeNull();
    expect(excludeRegex?.test('RAILWAY_TOKEN')).toBe(true);
    expect(excludeRegex?.test('GITHUB_TOKEN')).toBe(true);
    expect(excludeRegex?.test('METRICS_ENABLED')).toBe(false);
    expect(excludeRegex?.test('METRICS_SCRAPE_TOKEN')).toBe(false);
  });

  it('keeps METRICS_* in sync between env schema and deploy workflow', () => {
    const workflowContent = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8');
    const validation = validateMetricsDeploySync(workflowContent);
    expect(metricsDeploySyncHasErrors(validation)).toBe(false);
    expect(validation.workflowIsSchemaDriven).toBe(true);
    expect(validation.metricsExcludedFromSync).toEqual([]);
  });

  it('flags a deploy workflow that reverts to an enumerated sync loop', () => {
    const enumeratedLoopWorkflow = `
      for var in METRICS_ENABLED AUDIT_RETENTION_DAYS; do
        val="\${!var:-}"
      done
    `;
    const validation = validateMetricsDeploySync(enumeratedLoopWorkflow);
    expect(validation.workflowIsSchemaDriven).toBe(false);
    expect(metricsDeploySyncHasErrors(validation)).toBe(true);
  });

  it('flags METRICS_* keys that fall under the Railway exclude_regex', () => {
    const workflowWithMetricsExcluded = `
      env:
        GH_SECRETS_JSON: \${{ toJSON(secrets) }}
        GH_VARS_JSON: \${{ toJSON(vars) }}
      run: |
        exclude_regex='^(METRICS_.*|RAILWAY_TOKEN)$'
    `;
    const validation = validateMetricsDeploySync(workflowWithMetricsExcluded);
    expect(validation.workflowIsSchemaDriven).toBe(true);
    expect(validation.metricsExcludedFromSync).toContain('METRICS_ENABLED');
    expect(metricsDeploySyncHasErrors(validation)).toBe(true);
  });

  it('blocks deploy when validate:github-env fails (no continue-on-error, runs before deploy steps)', () => {
    const workflowContent = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8');
    const validateStepIndex = workflowContent.indexOf('name: Validate GitHub environment secrets');
    const nextDeployStepIndex = workflowContent.indexOf('name: Run database migrations');
    expect(validateStepIndex).toBeGreaterThan(-1);
    expect(nextDeployStepIndex).toBeGreaterThan(validateStepIndex);
    expect(workflowContent).toContain('run: pnpm validate:github-env');

    const validateStepSection = workflowContent.slice(validateStepIndex, nextDeployStepIndex);
    expect(validateStepSection).not.toMatch(/continue-on-error:\s*true/);
  });
});
