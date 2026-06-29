import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReadline, questionWithDefault } from '@tooling/setup/common/prompts.js';
import {
  writeEnvSetupTemplateIfMissing,
  updateEnvSetupHeader,
  appendMissingEnvSetupVariables,
  getEnvSetupValue,
  setEnvSetupVariable,
} from '@tooling/setup/common/secrets.js';
import { loadConfigIfExists } from '@tooling/setup/common/config.js';
import { SetupError } from '@tooling/setup/common/setup-error.js';
import { assertInteractive } from '@tooling/setup/common/interactive-step.js';
import * as logger from '@tooling/setup/common/logger.js';
import { buildDefaultArtifacts } from '@tooling/setup/codegen/project-identity.util.js';
import type { SetupConfig } from '@tooling/setup/common/types.js';

const SETUP_CONFIG_PATH = resolve(import.meta.dirname, '../setup.config.json');

export const DEFAULT_PROJECT_NAME = 'core-be';
export const DEFAULT_DISPLAY_NAME = 'Core Backend';
export const DEFAULT_ORGANIZATION = 'my-org';
export const DEFAULT_ENVIRONMENTS = 'development,production';

/**
 * Canonical environment → git branch mapping. Always use full names
 * (`development`, `production`) for environments; branches stay short
 * (`dev`, `main`). Add new entries here when an environment is introduced.
 */
const DEFAULT_BRANCH_FOR_ENVIRONMENT: Record<string, string> = {
  development: 'dev',
  production: 'main',
};

/**
 * Whether the branch backing this environment is protected by default
 * (required-checks, restricted pushes, etc.). `development` and `production`
 * are protected; preview / ephemeral environments default to unprotected.
 */
const DEFAULT_PROTECTED_FOR_ENVIRONMENT: Record<string, boolean> = {
  development: true,
  production: true,
};

export function isProductionEnvironmentName(name: string): boolean {
  return name === 'production';
}

export function labelForEnvironmentName(name: string): string {
  if (name === 'development') return 'Development';
  if (name === 'production') return 'Production';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function defaultBranchForEnvironmentName(name: string): string {
  return DEFAULT_BRANCH_FOR_ENVIRONMENT[name] ?? name;
}

export function defaultProtectedForEnvironmentName(name: string): boolean {
  return DEFAULT_PROTECTED_FOR_ENVIRONMENT[name] ?? false;
}

export function buildEnvironmentsFromNames(names: string[]): SetupConfig['environments'] {
  return names.map((name, index) => ({
    name,
    label: labelForEnvironmentName(name),
    nodeEnvironment: isProductionEnvironmentName(name) ? 'production' : 'development',
    branch: defaultBranchForEnvironmentName(name),
    protected: defaultProtectedForEnvironmentName(name),
    isDefault: index === 0,
  }));
}

export function buildConfig(
  organization: string,
  projectName: string,
  displayName: string,
  environmentNames: string[],
): SetupConfig {
  const environments = buildEnvironmentsFromNames(environmentNames);

  const rateLimitMax: Record<string, number> = {};
  const frontendUrl: Record<string, string> = {};
  const allowedOrigins: Record<string, string> = {};
  const sampleRates: Record<string, { traces: number; profile: number }> = {};

  for (const name of environmentNames) {
    const isProduction = isProductionEnvironmentName(name);
    const isDevelopment = name === 'development';
    rateLimitMax[name] = isDevelopment ? 10000 : isProduction ? 100 : 1000;
    frontendUrl[name] = isDevelopment
      ? 'http://localhost:3000'
      : isProduction
        ? 'https://app.example.com'
        : `https://${name}.example.com`;
    allowedOrigins[name] = frontendUrl[name];
    sampleRates[name] = isDevelopment
      ? { traces: 1, profile: 1 }
      : isProduction
        ? { traces: 0.1, profile: 0.1 }
        : { traces: 0.5, profile: 0.5 };
  }

  const artifacts = buildDefaultArtifacts(projectName);
  const protectedBranches = environments.map((environment) => environment.branch);
  const defaultBranch =
    environments.find((environment) => environment.isDefault)?.branch ?? protectedBranches[0];

  return {
    project: {
      name: projectName,
      displayName,
      organization,
      artifacts,
    },
    git: {
      protectedBranches,
      defaultBranch,
    },
    environments,
    providers: {
      neon: {
        enabled: true,
        region: 'aws-us-east-2',
        pgVersion: 17,
        computeSize: { min: 0.25, max: 1 },
      },
      railwayRedis: {
        enabled: true,
        region: 'asia-southeast1-eqsg3a',
        cpuLimit: 1,
        memoryLimitMb: 512,
      },
      aws: {
        enabled: true,
        region: 'us-east-1',
        s3BucketPrefix: projectName,
        iamUserPrefix: `${projectName}-s3`,
      },
      sentry: {
        enabled: true,
        organization,
        project: projectName,
        platform: 'node',
        sampleRates,
      },
      resend: {
        enabled: true,
        fromAddress: 'noreply@yourdomain.com',
        fromName: displayName,
      },
      stripe: { enabled: true },
      oauth: {
        google: { enabled: true },
        github: { enabled: true },
      },
      posthog: { enabled: true, region: 'us' },
      turnstile: { enabled: true },
      railway: { enabled: true },
      github: {
        enabled: true,
        repository: `${organization}/${projectName}`,
      },
      postman: { enabled: true },
      scalar: { enabled: true },
    },
    app: {
      port: 3000,
      host: '0.0.0.0',
      rateLimitMax,
      rateLimitWindowMs: 60000,
      frontendUrl,
      allowedOrigins,
    },
  };
}

export async function runInitWizard(): Promise<void> {
  assertInteractive();
  logger.info(
    'Setup init — we will ask for organization, project, and environments, then generate setup.config.json.',
  );
  logger.blank();

  const existingConfig = loadConfigIfExists();
  const defaultOrganization = existingConfig?.project.organization ?? DEFAULT_ORGANIZATION;
  const defaultProjectName = existingConfig?.project.name ?? DEFAULT_PROJECT_NAME;
  const defaultDisplayName = existingConfig?.project.displayName ?? DEFAULT_DISPLAY_NAME;
  const defaultEnvironments =
    existingConfig?.environments.map((environment) => environment.name).join(', ') ??
    DEFAULT_ENVIRONMENTS;

  const readline = createReadline();

  const organization = await questionWithDefault(
    readline,
    'Organization name',
    defaultOrganization,
  );
  const projectName = await questionWithDefault(readline, 'Project name', defaultProjectName);
  const displayName = await questionWithDefault(
    readline,
    'Project display name',
    defaultDisplayName,
  );
  const envInput = await questionWithDefault(
    readline,
    'Environments (comma-separated, full names — e.g. development,production)',
    defaultEnvironments,
  );

  const defaultNeonOrgId = getEnvSetupValue('NEON_ORG_ID');
  logger.info(
    '  Neon Organization ID: get it from https://console.neon.tech/app/settings → select Organization → General → Organization ID',
  );
  const neonOrgId = await questionWithDefault(
    readline,
    'Neon Organization ID (e.g. org-soft-block-10705736)',
    defaultNeonOrgId,
  );

  readline.close();

  const environmentNames = envInput
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (environmentNames.length === 0) {
    throw new SetupError(
      'At least one environment is required (full names — e.g. development or development,production).',
    );
  }

  const config = buildConfig(organization, projectName, displayName, environmentNames);

  writeFileSync(SETUP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  logger.success(`Wrote ${SETUP_CONFIG_PATH}`);
  logger.info(`  Project: ${config.project.displayName} (${config.project.name})`);
  logger.info(`  Organization: ${config.project.organization}`);
  logger.info(`  Environments: ${environmentNames.join(', ')}`);
  logger.blank();

  if (writeEnvSetupTemplateIfMissing(config)) {
    logger.success(
      'Wrote .setup-credentials (template with URLs for each key). Fill values then run pnpm setup:infra.',
    );
  } else {
    updateEnvSetupHeader(config);
    const addedKeys = appendMissingEnvSetupVariables(config);
    if (addedKeys.length > 0) {
      logger.success(`Added missing variable(s) to .setup-credentials: ${addedKeys.join(', ')}`);
    }
    logger.info(
      'Updated .setup-credentials header (Project/Organization/Environments). Edit secrets as needed, then run pnpm setup:infra.',
    );
  }

  if (neonOrgId.trim()) {
    setEnvSetupVariable('NEON_ORG_ID', neonOrgId.trim());
    logger.success('Set NEON_ORG_ID in .setup-credentials');
  }
}
