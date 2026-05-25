import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  metricsDeploySyncHasErrors,
  metricsEnvironmentVariableNames,
  parseRailwaySyncVariableNames,
  validateMetricsDeploySync,
} from '../../../../tooling/setup/github/deploy-sync.js';

const DEPLOY_WORKFLOW_PATH = resolve(import.meta.dirname, '../../../../.github/workflows/cd.yml');

describe('deploy-env-sync.util', () => {
  it('lists METRICS_* keys from env schema', () => {
    const names = metricsEnvironmentVariableNames();
    expect(names).toContain('METRICS_ENABLED');
    expect(names).toContain('METRICS_SCRAPE_TOKEN');
    expect(names.every((name) => name.startsWith('METRICS_'))).toBe(true);
  });

  it('parses Railway sync variable names from deploy workflow', () => {
    const workflowContent = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8');
    const railwayVariables = parseRailwaySyncVariableNames(workflowContent);
    expect(railwayVariables).toContain('METRICS_ENABLED');
    expect(railwayVariables).toContain('METRICS_SCRAPE_TOKEN');
    expect(railwayVariables).toContain('DATABASE_URL');
  });

  it('keeps METRICS_* in sync between env schema and deploy workflow', () => {
    const workflowContent = readFileSync(DEPLOY_WORKFLOW_PATH, 'utf-8');
    const validation = validateMetricsDeploySync(workflowContent);
    expect(metricsDeploySyncHasErrors(validation)).toBe(false);
    expect(validation.missingFromRailwaySyncLoop).toEqual([]);
    expect(validation.unknownMetricsInRailwaySyncLoop).toEqual([]);
    expect(validation.missingFromWorkflowSecrets).toEqual([]);
  });

  it('detects METRICS_* missing from Railway sync loop', () => {
    const workflowContent = `
      for var in METRICS_ENABLED AUDIT_RETENTION_DAYS; do
        val="\${!var:-}"
      done
    `;
    const validation = validateMetricsDeploySync(workflowContent);
    expect(validation.missingFromRailwaySyncLoop).toContain('METRICS_SCRAPE_TOKEN');
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
