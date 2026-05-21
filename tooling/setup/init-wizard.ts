import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createReadline, questionWithDefault } from './prompts.js';
import {
  writeEnvSetupTemplateIfMissing,
  updateEnvSetupHeader,
  appendMissingEnvSetupVariables,
  getEnvSetupValue,
  setEnvSetupVariable,
} from './env-secrets.js';
import { loadConfigIfExists } from './config.js';
import * as logger from './logger.util.js';
import type { SetupConfig } from './types.js';

const SETUP_CONFIG_PATH = resolve(import.meta.dirname, '../setup.config.json');

const DEFAULT_PROJECT_NAME = 'core-be';
const DEFAULT_DISPLAY_NAME = 'Core Backend';
const DEFAULT_ORGANIZATION = 'my-org';
const DEFAULT_ENVIRONMENTS = 'dev,alpha,beta,staging,production';

function buildEnvironmentsFromNames(names: string[]): SetupConfig['environments'] {
  return names.map((name, index) => {
    const isPrd =
      name === 'production' ||
      name === 'prod' ||
      name === 'prd' ||
      name.toLowerCase() === 'production';
    const label =
      name === 'dev'
        ? 'Development'
        : name === 'qa'
          ? 'QA / Staging'
          : name === 'production' || name === 'prod' || name === 'prd'
            ? 'Production'
            : name.charAt(0).toUpperCase() + name.slice(1);
    return {
      name,
      label,
      nodeEnvironment: isPrd ? 'production' : 'development',
      isDefault: index === 0,
    };
  });
}

function buildConfig(
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
    rateLimitMax[name] = name === 'dev' ? 10000 : name === 'qa' ? 1000 : 100;
    frontendUrl[name] =
      name === 'dev'
        ? 'http://localhost:3000'
        : name === 'production' || name === 'prod' || name === 'prd'
          ? 'https://app.example.com'
          : `https://${name}.example.com`;
    allowedOrigins[name] = frontendUrl[name];
    sampleRates[name] =
      name === 'dev'
        ? { traces: 1, profile: 1 }
        : name === 'production' || name === 'prod' || name === 'prd'
          ? { traces: 0.1, profile: 0.1 }
          : { traces: 0.5, profile: 0.5 };
  }

  return {
    project: {
      name: projectName,
      displayName,
      organization,
    },
    environments,
    providers: {
      neon: {
        enabled: true,
        region: 'aws-us-east-2',
        pgVersion: 17,
        computeSize: { min: 0.25, max: 1 },
      },
      upstash: {
        enabled: true,
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
      railway: { enabled: true },
      github: {
        enabled: true,
        repository: `${organization}/${projectName}`,
      },
      postman: { enabled: true },
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
    'Environments (comma-separated, e.g. dev,alpha,beta,staging,production)',
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
    logger.error(
      'At least one environment is required (e.g. dev or dev,alpha,beta,staging,production).',
    );
    process.exit(1);
  }

  const config = buildConfig(organization, projectName, displayName, environmentNames);

  writeFileSync(SETUP_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  logger.success(`Wrote ${SETUP_CONFIG_PATH}`);
  logger.info(`  Project: ${config.project.displayName} (${config.project.name})`);
  logger.info(`  Organization: ${config.project.organization}`);
  logger.info(`  Environments: ${environmentNames.join(', ')}`);
  logger.blank();

  if (writeEnvSetupTemplateIfMissing(config)) {
    logger.success(
      'Wrote .env.setup (template with URLs for each key). Fill values then run pnpm setup:infra.',
    );
  } else {
    updateEnvSetupHeader(config);
    const addedKeys = appendMissingEnvSetupVariables(config);
    if (addedKeys.length > 0) {
      logger.success(`Added missing variable(s) to .env.setup: ${addedKeys.join(', ')}`);
    }
    logger.info(
      'Updated .env.setup header (Project/Organization/Environments). Edit secrets as needed, then run pnpm setup:infra.',
    );
  }

  if (neonOrgId.trim()) {
    setEnvSetupVariable('NEON_ORG_ID', neonOrgId.trim());
    logger.success('Set NEON_ORG_ID in .env.setup');
  }
}
