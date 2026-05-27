import { envSchemaKeys } from '../../../src/shared/config/env-schema.js';

export const METRICS_ENVIRONMENT_VARIABLE_PREFIX = 'METRICS_';

const RAILWAY_TO_JSON_SECRETS_PATTERN = /toJSON\(\s*secrets\s*\)/;
const RAILWAY_TO_JSON_VARS_PATTERN = /toJSON\(\s*vars\s*\)/;
const RAILWAY_EXCLUDE_REGEX_LINE_PATTERN = /exclude_regex=['"]\^\(([^'"]+)\)\$['"]/;

/** Env schema keys for Prometheus metrics (METRICS_*). */
export function metricsEnvironmentVariableNames(): string[] {
  return envSchemaKeys
    .filter((key: string) => key.startsWith(METRICS_ENVIRONMENT_VARIABLE_PREFIX))
    .sort();
}

/**
 * The deploy step is **schema-driven**: it merges every GitHub Environment
 * secret and variable (via `toJSON(secrets)` / `toJSON(vars)`) into a JSON
 * payload and pushes the lot to Railway, minus an explicit infra/CI
 * `exclude_regex`. There is no longer a hand-maintained allow-list of names.
 *
 * This helper confirms the workflow still uses that schema-driven pattern;
 * if a refactor ever reverts to an enumerated `for var in ...; do` loop the
 * validator below will fail and force a documentation/test update.
 */
export function isRailwaySyncSchemaDriven(deployWorkflowContent: string): boolean {
  return (
    RAILWAY_TO_JSON_SECRETS_PATTERN.test(deployWorkflowContent) &&
    RAILWAY_TO_JSON_VARS_PATTERN.test(deployWorkflowContent)
  );
}

/**
 * Extract the `exclude_regex='^(...)$'` skip-list from the deploy workflow.
 * Returns a compiled `RegExp` matching the full key, or `null` when no such
 * line is present (in which case nothing is excluded from the sync).
 */
export function getRailwayExcludeRegex(deployWorkflowContent: string): RegExp | null {
  const match = deployWorkflowContent.match(RAILWAY_EXCLUDE_REGEX_LINE_PATTERN);
  if (!match) return null;
  return new RegExp(`^(${match[1]})$`);
}

export type MetricsDeploySyncValidation = {
  schemaMetricsVariables: string[];
  workflowIsSchemaDriven: boolean;
  metricsExcludedFromSync: string[];
};

/**
 * Confirm METRICS_* variables flow through the schema-driven Railway sync:
 *   - The workflow merges `toJSON(secrets)` and `toJSON(vars)` (sync-all).
 *   - No METRICS_* key is caught by the infra/CI `exclude_regex`.
 *
 * The schema → Railway pipeline is: env-schema declares METRICS_*, the local
 * `.env.<environment>` carries the value, `pnpm github:sync` pushes it to the
 * GitHub Environment, and the deploy workflow forwards it to Railway via the
 * JSON merge. Any link in that chain breaking is what this validator catches.
 */
export function validateMetricsDeploySync(
  deployWorkflowContent: string,
): MetricsDeploySyncValidation {
  const schemaMetricsVariables = metricsEnvironmentVariableNames();
  const workflowIsSchemaDriven = isRailwaySyncSchemaDriven(deployWorkflowContent);
  const excludeRegex = getRailwayExcludeRegex(deployWorkflowContent);
  const metricsExcludedFromSync = excludeRegex
    ? schemaMetricsVariables.filter((name) => excludeRegex.test(name))
    : [];

  return {
    schemaMetricsVariables,
    workflowIsSchemaDriven,
    metricsExcludedFromSync,
  };
}

export function metricsDeploySyncHasErrors(validation: MetricsDeploySyncValidation): boolean {
  return !validation.workflowIsSchemaDriven || validation.metricsExcludedFromSync.length > 0;
}
