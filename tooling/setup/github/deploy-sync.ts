import { envSchemaKeys } from '../../../src/shared/config/env-schema.js';

export const METRICS_ENVIRONMENT_VARIABLE_PREFIX = 'METRICS_';

const RAILWAY_SYNC_LOOP_PATTERN = /for var in\s*\\?\s*([\s\S]*?)\s*; do/g;

/** Env schema keys for Prometheus metrics (METRICS_*). */
export function metricsEnvironmentVariableNames(): string[] {
  return envSchemaKeys
    .filter((key: string) => key.startsWith(METRICS_ENVIRONMENT_VARIABLE_PREFIX))
    .sort();
}

/**
 * Variable names listed in every `for var in ... ; do` loop inside
 * reusable-railway-deploy.yml `railway variable set` step. The deploy step
 * uses two loops (one for GitHub Secrets, one for GitHub Variables); both
 * contribute names so the caller sees a single deduplicated list.
 */
export function parseRailwaySyncVariableNames(deployWorkflowContent: string): string[] {
  const names = new Set<string>();
  for (const match of deployWorkflowContent.matchAll(RAILWAY_SYNC_LOOP_PATTERN)) {
    const body = match[1];
    if (!body) continue;
    for (const token of body.split(/\s+/)) {
      const trimmed = token.trim();
      if (/^[A-Z][A-Z0-9_]*$/.test(trimmed)) {
        names.add(trimmed);
      }
    }
  }
  return [...names];
}

export type MetricsDeploySyncValidation = {
  schemaMetricsVariables: string[];
  missingFromRailwaySyncLoop: string[];
  unknownMetricsInRailwaySyncLoop: string[];
  missingFromWorkflowSecrets: string[];
};

export function validateMetricsDeploySync(
  deployWorkflowContent: string,
): MetricsDeploySyncValidation {
  const schemaMetricsVariables = metricsEnvironmentVariableNames();
  const railwaySyncVariableNames = parseRailwaySyncVariableNames(deployWorkflowContent);
  const railwaySyncSet = new Set(railwaySyncVariableNames);
  const schemaMetricsSet = new Set(schemaMetricsVariables);

  const missingFromRailwaySyncLoop = schemaMetricsVariables.filter(
    (name) => !railwaySyncSet.has(name),
  );

  const unknownMetricsInRailwaySyncLoop = railwaySyncVariableNames.filter(
    (name) => name.startsWith(METRICS_ENVIRONMENT_VARIABLE_PREFIX) && !schemaMetricsSet.has(name),
  );

  const missingFromWorkflowSecrets = schemaMetricsVariables.filter((name) => {
    // Accept either GitHub Secret (`secrets.X`) or GitHub Variable (`vars.X`) references.
    // The secrets-vs-variables split is documented in
    // `docs/reference/architecture/env-naming-conventions.md`.
    const referencePattern = new RegExp(
      `${name}:\\s*\\$\\{\\{\\s*(?:secrets|vars)\\.${name}\\s*\\}\\}`,
    );
    return !referencePattern.test(deployWorkflowContent);
  });

  return {
    schemaMetricsVariables,
    missingFromRailwaySyncLoop,
    unknownMetricsInRailwaySyncLoop,
    missingFromWorkflowSecrets,
  };
}

export function metricsDeploySyncHasErrors(validation: MetricsDeploySyncValidation): boolean {
  return (
    validation.missingFromRailwaySyncLoop.length > 0 ||
    validation.unknownMetricsInRailwaySyncLoop.length > 0 ||
    validation.missingFromWorkflowSecrets.length > 0
  );
}
