import { envSchemaKeys } from '../../src/shared/config/env-schema.js';

export const METRICS_ENVIRONMENT_VARIABLE_PREFIX = 'METRICS_';

const RAILWAY_SYNC_LOOP_PATTERN = /for var in\s*\\?\s*([\s\S]*?)\s*; do/;

/** Env schema keys for Prometheus metrics (METRICS_*). */
export function metricsEnvironmentVariableNames(): string[] {
  return envSchemaKeys.filter((key) => key.startsWith(METRICS_ENVIRONMENT_VARIABLE_PREFIX)).sort();
}

/** Variable names listed in deploy-railway.yml `railway variable set` loop. */
export function parseRailwaySyncVariableNames(deployWorkflowContent: string): string[] {
  const loopMatch = deployWorkflowContent.match(RAILWAY_SYNC_LOOP_PATTERN);
  if (!loopMatch?.[1]) {
    return [];
  }

  return loopMatch[1]
    .split(/\s+/)
    .map((name) => name.trim())
    .filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name));
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
