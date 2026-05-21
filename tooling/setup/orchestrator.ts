import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import * as logger from './logger.util.js';
import { loadConfig, getEnvironmentNames } from './config.js';
import { loadSecrets, isSecretFilled, getSecretsPath, ensureEnvSetupTemplate } from './secrets.js';
import { hasAnyEnvSecret } from './env-secrets.js';
import { loadState, saveState, clearState, stateFileExists } from './state.js';
import { checkPrerequisites } from './prerequisites.js';
import { runGuide } from './guide.js';
import * as neonProvider from './providers/neon.provider.js';
import * as upstashProvider from './providers/upstash.provider.js';
import * as awsProvider from './providers/aws.provider.js';
import * as sentryProvider from './providers/sentry.provider.js';
import * as jwtProvider from './providers/jwt.provider.js';
import * as resendProvider from './providers/resend.provider.js';
import * as stripeProvider from './providers/stripe.provider.js';
import * as oauthProvider from './providers/oauth.provider.js';
import * as railwayProvider from './providers/railway.provider.js';
import * as githubProvider from './providers/github.provider.js';
import * as postmanProvider from './providers/postman.provider.js';
import { exportEnvFiles } from './export-env-files.js';
import type { SetupConfig, SetupSecrets, SetupState, ProviderResult } from './types.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../');

// ─── HELPERS ────────────────────────────────────────────────────────────────

async function confirm(message: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    readline.question(`  ${message} (y/N): `, (answer) => {
      readline.close();
      resolvePromise(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function doubleConfirm(): Promise<boolean> {
  const first = await confirm('Are these settings correct?');
  if (!first) return false;

  logger.blank();
  const second = await confirm(
    'FINAL CONFIRMATION: Proceed with provisioning? This will create REAL resources.',
  );
  return second;
}

function applyStateUpdates(state: SetupState, result: ProviderResult): void {
  if (result.stateUpdates) {
    Object.assign(state, result.stateUpdates);
    saveState(state);
  }
}

function runMigrations(databaseUrl: string, environmentName: string): boolean {
  const spinner = logger.startSpinner(`Running migrations for "${environmentName}"...`);
  try {
    execSync('pnpm db:migrate', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    logger.stopSpinner(spinner, `Migrations complete for "${environmentName}"`);
    return true;
  } catch (migrationError) {
    const message =
      migrationError instanceof Error ? migrationError.message : String(migrationError);
    logger.stopSpinner(spinner, `Migration failed for "${environmentName}": ${message}`, 'fail');
    return false;
  }
}

function runSeed(databaseUrl: string, environmentName: string): boolean {
  const spinner = logger.startSpinner(`Seeding "${environmentName}"...`);
  try {
    execSync('pnpm db:seed', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    logger.stopSpinner(spinner, `Seed complete for "${environmentName}"`);
    return true;
  } catch (seedError) {
    const message = seedError instanceof Error ? seedError.message : String(seedError);
    logger.stopSpinner(spinner, `Seed failed for "${environmentName}": ${message}`, 'fail');
    return false;
  }
}

// ─── SETTINGS REVIEW ────────────────────────────────────────────────────────

function displaySettingsReview(config: SetupConfig, environments: string[]): void {
  const resources: Array<{ provider: string; detail: string }> = [];
  const extras: Array<{ provider: string; detail: string }> = [];

  if (config.providers.neon.enabled) {
    resources.push({
      provider: 'Neon Postgres',
      detail: `1 project + ${environments.length} branches (${config.providers.neon.region})`,
    });
  }

  if (config.providers.upstash.enabled) {
    resources.push({
      provider: 'Upstash Redis',
      detail: 'Shared Redis URL from .env.setup (UPSTASH_REDIS_URL)',
    });
  }

  if (config.providers.aws.enabled) {
    resources.push({
      provider: 'AWS S3',
      detail: `${environments.length} buckets + ${environments.length} IAM users (${config.providers.aws.region})`,
    });
  }

  if (config.providers.sentry.enabled) {
    resources.push({
      provider: 'Sentry',
      detail: `1 project (${config.providers.sentry.organization}/${config.providers.sentry.project ?? config.providers.sentry.team})`,
    });
  }

  resources.push({
    provider: 'JWT',
    detail: `${environments.length} secrets (auto-generated)`,
  });

  if (config.providers.railway.enabled) {
    resources.push({
      provider: 'Railway',
      detail: `1 project + ${environments.length} services`,
    });
  }

  if (config.providers.github.enabled) {
    resources.push({
      provider: 'GitHub',
      detail: `repository + environment secrets (${config.providers.github.repository})`,
    });
  }

  if (config.providers.stripe.enabled) {
    extras.push({ provider: 'Stripe', detail: `validate ${environments.length} keys` });
  }
  if (config.providers.resend.enabled) {
    extras.push({ provider: 'Resend', detail: 'validate 1 key' });
  }
  if (config.providers.oauth.google.enabled || config.providers.oauth.github.enabled) {
    extras.push({ provider: 'OAuth', detail: 'validate Google + GitHub per env' });
  }
  if (config.providers.postman.enabled) {
    extras.push({ provider: 'Postman', detail: 'upload collection' });
  }

  extras.push({ provider: 'Migrations', detail: `run on all ${environments.length} environments` });

  const defaultEnv = config.environments.find((env) => env.isDefault);
  if (defaultEnv) {
    extras.push({ provider: 'Seed', detail: `${defaultEnv.name} environment` });
  }

  logger.settingsReview(
    config.project.name,
    config.project.organization,
    environments,
    resources,
    extras,
  );
}

// ─── PRE-EXISTENCE CHECK ────────────────────────────────────────────────────

async function checkForExistingResources(
  config: SetupConfig,
  secrets: SetupSecrets,
  environments: string[],
): Promise<Array<{ provider: string; detail: string }>> {
  const existing: Array<{ provider: string; detail: string }> = [];

  logger.info('Checking for existing resources...');
  logger.blank();

  // Check Neon
  if (config.providers.neon.enabled && isSecretFilled(secrets.neon.apiKey)) {
    try {
      const response = await fetch('https://console.neon.tech/api/v2/projects', {
        headers: { Authorization: `Bearer ${secrets.neon.apiKey}`, Accept: 'application/json' },
      });
      if (response.ok) {
        const data = (await response.json()) as { projects: Array<{ name: string; id: string }> };
        const match = data.projects?.find((project) => project.name === config.project.name);
        if (match) {
          existing.push({
            provider: 'Neon Postgres',
            detail: `project "${config.project.name}" already exists (${match.id})`,
          });
        }
      }
    } catch {
      logger.warn('  Could not check Neon for existing resources');
    }
  }

  // Upstash: no pre-existence check (user provides URL)

  // Check AWS S3 buckets
  if (config.providers.aws.enabled && isSecretFilled(secrets.aws.accessKeyId)) {
    const s3Client = new S3Client({
      region: config.providers.aws.region,
      credentials: {
        accessKeyId: secrets.aws.accessKeyId,
        secretAccessKey: secrets.aws.secretAccessKey,
      },
    });
    for (const environmentName of environments) {
      const bucketName = `${config.providers.aws.s3BucketPrefix}-${environmentName}-uploads`;
      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
        existing.push({ provider: 'AWS S3', detail: `bucket "${bucketName}" already exists` });
      } catch {
        // Bucket does not exist — good
      }
    }
    s3Client.destroy();
  }

  // Check Sentry
  if (config.providers.sentry.enabled && isSecretFilled(secrets.sentry.authToken)) {
    try {
      const response = await fetch(
        `https://sentry.io/api/0/projects/${config.providers.sentry.organization}/${config.project.name}/`,
        {
          headers: {
            Authorization: `Bearer ${secrets.sentry.authToken}`,
            Accept: 'application/json',
          },
        },
      );
      if (response.ok) {
        existing.push({
          provider: 'Sentry',
          detail: `project "${config.project.name}" already exists`,
        });
      }
    } catch {
      logger.warn('  Could not check Sentry for existing resources');
    }
  }

  // Check state file (indicates previous partial or complete run)
  if (stateFileExists()) {
    const state = loadState();
    if (state.neon || state.redis || state.aws || state.sentry || state.railway) {
      existing.push({
        provider: 'State file',
        detail: '.setup-state.json contains previous provisioning data',
      });
    }
  }

  return existing;
}

// ─── PREVIEW ────────────────────────────────────────────────────────────────

const PREVIEW_PROVIDERS: Array<{
  enabledCheck: (config: SetupConfig) => boolean;
  provider: string;
  detail: string;
  url: string;
  configKey: string;
}> = [
  {
    enabledCheck: (config) => config.providers.neon.enabled,
    provider: 'Neon Postgres',
    detail: `1 project + branches per env`,
    url: 'https://console.neon.tech/app/settings/api-keys',
    configKey: 'neon.apiKey',
  },
  {
    enabledCheck: (config) => config.providers.upstash.enabled,
    provider: 'Upstash Redis',
    detail: 'Shared Redis URL',
    url: 'https://console.upstash.com/',
    configKey: 'UPSTASH_REDIS_URL',
  },
  {
    enabledCheck: (config) => config.providers.aws.enabled,
    provider: 'AWS IAM',
    detail: 'Access Key ID + Secret',
    url: 'https://console.aws.amazon.com/iam/home#/users',
    configKey: 'aws.accessKeyId, aws.secretAccessKey',
  },
  {
    enabledCheck: (config) => config.providers.sentry.enabled,
    provider: 'Sentry',
    detail: 'Auth token',
    url: 'https://sentry.io/settings/auth-tokens/new-token/',
    configKey: 'sentry.authToken',
  },
  {
    enabledCheck: (config) => config.providers.resend.enabled,
    provider: 'Resend',
    detail: 'API key',
    url: 'https://resend.com/api-keys',
    configKey: 'resend.apiKey',
  },
  {
    enabledCheck: (config) => config.providers.stripe.enabled,
    provider: 'Stripe',
    detail: 'Secret key per env (development/production)',
    url: 'https://dashboard.stripe.com/test/apikeys',
    configKey: 'stripe.<env>.secretKey',
  },
  {
    enabledCheck: (config) => config.providers.oauth.google.enabled,
    provider: 'Google OAuth',
    detail: 'Client ID + Secret per env',
    url: 'https://console.cloud.google.com/apis/credentials',
    configKey: 'oauth.google.<env>.clientId, clientSecret, redirectUri',
  },
  {
    enabledCheck: (config) => config.providers.oauth.github.enabled,
    provider: 'GitHub OAuth',
    detail: 'Client ID + Secret per env',
    url: 'https://github.com/settings/developers',
    configKey: 'oauth.github.<env>.clientId, clientSecret, redirectUri',
  },
  {
    enabledCheck: (config) => config.providers.railway.enabled,
    provider: 'Railway',
    detail: 'RAILWAY_TOKEN — no railway login when set (API-only)',
    url: 'https://railway.app/account/tokens',
    configKey: 'RAILWAY_TOKEN',
  },
  {
    enabledCheck: (config) => config.providers.github.enabled,
    provider: 'GitHub',
    detail:
      'GITHUB_TOKEN — repo/env secrets (no gh auth login when set). See docs/deployment/setup-token-instructions.md',
    url: 'https://github.com/settings/tokens',
    configKey: 'GITHUB_TOKEN',
  },
  {
    enabledCheck: (config) => config.providers.postman.enabled,
    provider: 'Postman',
    detail: 'API key + Workspace ID',
    url: 'https://go.postman.co/settings/me/api-keys',
    configKey: 'postman.apiKey, postman.workspaceId',
  },
];

export function runPreview(): void {
  const config = loadConfig();
  const environments = getEnvironmentNames(config);

  logger.banner(config.project.displayName, environments);

  const configPath = resolve(import.meta.dirname, '../setup.config.json');
  const secretsPath = getSecretsPath();

  if (ensureEnvSetupTemplate(config)) {
    logger.info(
      'Generated .env.setup template — fill values and run pnpm setup:infra:preview or setup:infra again.',
    );
  }

  const providers = PREVIEW_PROVIDERS.filter((provider) => provider.enabledCheck(config)).map(
    (provider) => ({
      provider: provider.provider,
      detail: provider.detail,
      url: provider.url,
      configKey: provider.configKey,
    }),
  );

  logger.previewPlan(configPath, secretsPath, providers);
}

// ─── ROLLBACK ───────────────────────────────────────────────────────────────

type ProviderName = 'neon' | 'upstash' | 'aws' | 'sentry' | 'railway';

async function rollback(
  completedProviders: ProviderName[],
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
): Promise<void> {
  logger.blank();
  logger.warn('Rolling back all created resources...');
  logger.blank();

  const reversed = [...completedProviders].reverse();

  for (const providerName of reversed) {
    try {
      switch (providerName) {
        case 'railway':
          if (state.railway) await railwayProvider.destroy(state, secrets.railway.token);
          break;
        case 'sentry':
          if (state.sentry)
            await sentryProvider.destroy(state, secrets, config.providers.sentry.organization);
          break;
        case 'aws':
          if (state.aws) await awsProvider.destroy(state, secrets);
          break;
        case 'upstash':
          // No resources to destroy
          break;
        case 'neon':
          if (state.neon) await neonProvider.destroy(state, secrets);
          break;
      }
    } catch (rollbackError) {
      const message =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      logger.error(`  Rollback of "${providerName}" failed: ${message}`);
    }
  }

  clearState();
  logger.blank();
  logger.error('Setup aborted. All created resources have been reverted. State cleared.');
}

// ─── PROVISION ──────────────────────────────────────────────────────────────

export async function runProvision(): Promise<void> {
  const config = loadConfig();
  const environments = getEnvironmentNames(config);

  logger.banner(config.project.displayName, environments);

  // Step 1: Prerequisites
  const prerequisitesOk = checkPrerequisites(config);
  if (!prerequisitesOk) {
    process.exit(1);
  }

  if (ensureEnvSetupTemplate(config)) {
    logger.info(
      'Generated .env.setup template. Fill the values (see URLs in the file) and run pnpm setup:infra again.',
    );
    process.exit(0);
  }

  // Step 2: Browser-guided auth
  await runGuide(config);

  // Step 3: Load secrets
  const secrets = loadSecrets(config);

  if (!hasAnyEnvSecret(environments)) {
    logger.error(
      'No secrets found. Fill .env.setup with your API keys (each variable has a comment with the URL to get it).',
    );
    logger.info('Then run pnpm setup:infra again.');
    process.exit(1);
  }

  // Step 4: Settings review + double confirmation
  displaySettingsReview(config, environments);

  const confirmed = await doubleConfirm();
  if (!confirmed) {
    logger.blank();
    logger.info('Aborted. No resources were created.');
    process.exit(0);
  }

  logger.blank();

  // Step 5: Pre-existence check
  const existingResources = await checkForExistingResources(config, secrets, environments);
  if (existingResources.length > 0) {
    logger.existingResourcesError(existingResources);
    process.exit(1);
  }

  logger.success('No existing resources found — safe to proceed.');
  logger.blank();

  // Step 6: Atomic provisioning — all or nothing
  const state = loadState();
  const completedProviders: ProviderName[] = [];

  try {
    // 6a. Neon Postgres
    if (config.providers.neon.enabled && isSecretFilled(secrets.neon.apiKey)) {
      logger.divider();
      logger.info('Provisioning Neon Postgres...');
      const result = await neonProvider.provision(config, secrets, state, environments);
      if (!result.success) throw new Error(`Neon: ${result.message}`);
      applyStateUpdates(state, result);
      completedProviders.push('neon');
      logger.success(result.message);
    }

    // 6b. Upstash Redis
    if (config.providers.upstash.enabled && isSecretFilled(secrets.upstash.redisUrl)) {
      logger.divider();
      logger.info('Using Upstash Redis (UPSTASH_REDIS_URL from .env.setup)...');
      const result = await upstashProvider.provision(config, secrets, state, environments);
      if (!result.success) throw new Error(`Upstash: ${result.message}`);
      applyStateUpdates(state, result);
      completedProviders.push('upstash');
      logger.success(result.message);
    }

    // 6c. AWS S3
    if (config.providers.aws.enabled && isSecretFilled(secrets.aws.accessKeyId)) {
      logger.divider();
      logger.info('Provisioning AWS S3...');
      const result = await awsProvider.provision(config, secrets, state, environments);
      if (!result.success) throw new Error(`AWS: ${result.message}`);
      applyStateUpdates(state, result);
      completedProviders.push('aws');
      logger.success(result.message);
    }

    // 6d. Sentry
    if (config.providers.sentry.enabled && isSecretFilled(secrets.sentry.authToken)) {
      logger.divider();
      logger.info('Provisioning Sentry...');
      const result = await sentryProvider.provision(config, secrets, state);
      if (!result.success) throw new Error(`Sentry: ${result.message}`);
      applyStateUpdates(state, result);
      completedProviders.push('sentry');
      logger.success(result.message);
    }

    // 6e. JWT Secrets (local generation, no rollback needed)
    {
      logger.divider();
      logger.info('Generating JWT secrets...');
      const result = jwtProvider.provision(state, environments);
      applyStateUpdates(state, result);
      logger.success(result.message);
    }

    // 6f. Validate Resend (no resources created)
    if (config.providers.resend.enabled && isSecretFilled(secrets.resend.apiKey)) {
      logger.divider();
      const result = await resendProvider.provision(secrets);
      if (!result.success) throw new Error(`Resend: ${result.message}`);
      logger.success(result.message);
    }

    // 6g. Validate Stripe (no resources created)
    if (config.providers.stripe.enabled) {
      logger.divider();
      const result = await stripeProvider.provision(secrets, environments);
      if (!result.success) throw new Error(`Stripe: ${result.message}`);
      logger.success(result.message);
    }

    // 6h. Validate OAuth (no resources created)
    if (config.providers.oauth.google.enabled || config.providers.oauth.github.enabled) {
      logger.divider();
      const result = await oauthProvider.provision(config, secrets, environments);
      if (!result.success) throw new Error(`OAuth: ${result.message}`);
      logger.success(result.message);
    }

    // 6i. Railway
    if (config.providers.railway.enabled && isSecretFilled(secrets.railway.token)) {
      logger.divider();
      logger.info('Setting up Railway...');
      const result = await railwayProvider.provision(config, secrets, state, environments);
      if (!result.success) throw new Error(`Railway: ${result.message}`);
      applyStateUpdates(state, result);
      completedProviders.push('railway');
      logger.success(result.message);
    }

    // 6k. GitHub secrets (not tracked for rollback — secrets can be overwritten safely)
    if (config.providers.github.enabled) {
      logger.divider();
      logger.info('Setting GitHub secrets...');
      const result = await githubProvider.provision(config, secrets, state, environments);
      if (!result.success) throw new Error(`GitHub: ${result.message}`);
      applyStateUpdates(state, result);
      logger.success(result.message);
    }
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.blank();
    logger.error(`Provisioning failed: ${message}`);
    await rollback(completedProviders, config, secrets, state);
    process.exit(1);
  }

  // Step 7: Migrations (post-provisioning, non-rollbackable resources)
  logger.divider();
  logger.info('Running database migrations...');
  const migrationResults: Record<string, boolean> = {};
  for (const environmentName of environments) {
    const databaseUrl = state.neon?.branches?.[environmentName]?.databaseUrl;
    if (databaseUrl) {
      migrationResults[environmentName] = runMigrations(databaseUrl, environmentName);
    } else {
      logger.warn(`No DATABASE_URL for "${environmentName}" — skipping migrations`);
      migrationResults[environmentName] = false;
    }
  }
  state.migrations = migrationResults;
  saveState(state);

  // Step 8: Seed default environment
  const defaultEnvironment = config.environments.find((env) => env.isDefault);
  if (defaultEnvironment) {
    logger.divider();
    const seedDatabaseUrl = state.neon?.branches?.[defaultEnvironment.name]?.databaseUrl;
    if (seedDatabaseUrl && migrationResults[defaultEnvironment.name]) {
      const seedResult = runSeed(seedDatabaseUrl, defaultEnvironment.name);
      state.seeded = { [defaultEnvironment.name]: seedResult };
      saveState(state);
    }
  }

  // Step 9: Postman (non-critical, no rollback)
  if (config.providers.postman.enabled && isSecretFilled(secrets.postman?.apiKey)) {
    logger.divider();
    logger.info('Uploading Postman collection...');
    const result = await postmanProvider.provision(secrets, state);
    applyStateUpdates(state, result);
    if (result.success) logger.success(result.message);
    else logger.warn(`Postman: ${result.message}`);
  }

  // Summary
  logger.divider();
  logger.blank();
  logger.success('Setup completed successfully! All resources provisioned.');

  const summaryItems: Array<{ label: string; value: string }> = [];

  if (state.neon?.projectId) {
    summaryItems.push({ label: 'Neon Project', value: state.neon.projectId });
    for (const [env, branch] of Object.entries(state.neon.branches)) {
      summaryItems.push({ label: `  ${env} branch`, value: branch.branchId });
    }
  }

  if (config.providers.upstash.enabled) {
    summaryItems.push({ label: 'Upstash Redis', value: 'from .env.setup' });
  }

  if (state.aws?.buckets) {
    for (const [env, bucket] of Object.entries(state.aws.buckets)) {
      summaryItems.push({ label: `S3 Bucket (${env})`, value: bucket.name });
    }
  }

  if (state.sentry?.projectSlug) {
    summaryItems.push({ label: 'Sentry Project', value: state.sentry.projectSlug });
  }

  if (state.railway?.projectId) {
    summaryItems.push({ label: 'Railway Project', value: state.railway.projectId });
  }

  if (state.github?.secrets?.length) {
    summaryItems.push({ label: 'GitHub Secrets', value: state.github.secrets.join(', ') });
  }

  if (summaryItems.length > 0) {
    logger.summary('Provisioned Resources', summaryItems);
  }

  // Write .env.<environment> files for pushing to GitHub Environment secrets
  try {
    const written = exportEnvFiles();
    logger.blank();
    logger.success(
      `Wrote ${written.join(', ')} — use them to push secrets to GitHub Environments (e.g. gh secret set --env <env> --body-file .env.<env>).`,
    );
  } catch (exportError) {
    const message = exportError instanceof Error ? exportError.message : String(exportError);
    logger.blank();
    logger.warn(
      `Could not write .env.<environment> files: ${message}. Run pnpm setup:infra:export-env later.`,
    );
  }
}

// ─── CHECK ──────────────────────────────────────────────────────────────────

export async function runCheck(): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();

  logger.banner(config.project.displayName, getEnvironmentNames(config));
  logger.info('Running health checks...');
  logger.blank();

  let allHealthy = true;

  if (config.providers.neon.enabled && state.neon) {
    const healthy = await neonProvider.check(state, secrets);
    if (!healthy) allHealthy = false;
  }

  if (config.providers.upstash.enabled) {
    const healthy = await upstashProvider.check(state, secrets);
    if (!healthy) allHealthy = false;
  }

  if (config.providers.aws.enabled && state.aws) {
    const healthy = await awsProvider.check(state, secrets, config.providers.aws.region);
    if (!healthy) allHealthy = false;
  }

  if (config.providers.sentry.enabled && state.sentry) {
    const healthy = await sentryProvider.check(
      state,
      secrets,
      config.providers.sentry.organization,
    );
    if (!healthy) allHealthy = false;
  }

  if (config.providers.railway.enabled && state.railway) {
    const healthy = await railwayProvider.check(state, secrets.railway.token);
    if (!healthy) allHealthy = false;
  }

  if (config.providers.github.enabled && state.github) {
    const healthy = await githubProvider.check(state);
    if (!healthy) allHealthy = false;
  }

  logger.blank();
  if (allHealthy) {
    logger.success('All resources are healthy.');
  } else {
    logger.error('Some resources have issues. Run "pnpm setup:infra" to re-provision.');
  }
}

// ─── STATUS ─────────────────────────────────────────────────────────────────

export function runStatus(): void {
  const config = loadConfig();
  const state = loadState();

  logger.banner(config.project.displayName, getEnvironmentNames(config));

  const rows: Array<{ env: string; status: string; detail: string }> = [];

  for (const environment of config.environments) {
    const neonOk = !!state.neon?.branches?.[environment.name]?.databaseUrl;
    const redisOk = config.providers.upstash.enabled
      ? true
      : !!state.redis?.databases?.[environment.name]?.redisUrl;
    const awsOk = !!state.aws?.buckets?.[environment.name];
    const jwtOk = !!state.jwt?.[environment.name];
    const migrated = !!state.migrations?.[environment.name];

    const allOk = neonOk && redisOk && awsOk && jwtOk;

    const details: string[] = [];
    if (!neonOk) details.push('Neon');
    if (!redisOk) details.push('Upstash');
    if (!awsOk) details.push('AWS');
    if (!jwtOk) details.push('JWT');

    rows.push({
      env: environment.name,
      status: allOk ? 'OK' : 'MISSING',
      detail: allOk ? `migrated: ${migrated ? 'yes' : 'no'}` : `missing: ${details.join(', ')}`,
    });
  }

  logger.table(rows);

  const sharedItems: Array<{ label: string; value: string }> = [];
  sharedItems.push({ label: 'Sentry', value: state.sentry ? 'configured' : 'not configured' });
  sharedItems.push({
    label: 'Railway',
    value: state.railway
      ? `${Object.keys(state.railway.services).length} services`
      : 'not configured',
  });
  sharedItems.push({
    label: 'GitHub Secrets',
    value: state.github ? `${state.github.secrets.length} secrets` : 'not configured',
  });

  logger.summary('Shared Resources', sharedItems);
}

// ─── UPDATE ─────────────────────────────────────────────────────────────────

export async function runUpdate(): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();
  const environments = getEnvironmentNames(config);

  logger.banner(config.project.displayName, environments);
  logger.info('Re-syncing secrets to GitHub...');
  logger.blank();

  if (config.providers.github.enabled) {
    const result = await githubProvider.provision(config, secrets, state, environments);
    applyStateUpdates(state, result);
    if (result.success) {
      logger.success(result.message);
    } else {
      logger.error(result.message);
    }
  } else {
    logger.warn('GitHub is disabled in config. Nothing to update.');
  }
}

// ─── REVERT (per environment) ─────────────────────────────────────────────────

async function askEnvironment(environments: string[]): Promise<string | null> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    logger.info(`Which environment to revert? (${environments.join(' / ')})`);
    logger.info('  All services for that environment will be reverted. No partial revert.');
    readline.question(`  Environment: `, (answer) => {
      readline.close();
      const chosen = answer.trim().toLowerCase();
      if (environments.includes(chosen)) {
        resolve(chosen);
      } else {
        logger.warn(`Invalid environment "${answer}". Use one of: ${environments.join(', ')}`);
        resolve(null);
      }
    });
  });
}

function buildRevertListForEnvironment(
  environmentName: string,
  config: SetupConfig,
  state: SetupState,
): Array<{ provider: string; detail: string }> {
  const resources: Array<{ provider: string; detail: string }> = [];

  // Order matches setup: Neon, Redis, AWS, Railway
  if (state.neon?.branches?.[environmentName]) {
    const branch = state.neon.branches[environmentName];
    const isMain = branch.branchId === 'main';
    resources.push({
      provider: 'Neon Postgres',
      detail: isMain ? `branch "main" (deleting whole project)` : `branch "${environmentName}"`,
    });
  }

  if (state.aws?.buckets?.[environmentName]) {
    resources.push({
      provider: 'AWS S3',
      detail: `bucket "${state.aws.buckets[environmentName].name}"`,
    });
  }

  if (state.aws?.iamUsers?.[environmentName]) {
    resources.push({
      provider: 'AWS IAM',
      detail: `user "${state.aws.iamUsers[environmentName].username}"`,
    });
  }

  if (state.railway?.services?.[environmentName]) {
    resources.push({
      provider: 'Railway',
      detail: `service "${environmentName}"`,
    });
  }

  return resources;
}

function removeEnvironmentFromState(state: SetupState, environmentName: string): void {
  if (state.neon?.branches) {
    delete state.neon.branches[environmentName];
  }
  if (state.redis?.databases) {
    delete state.redis.databases[environmentName];
  }
  if (state.aws?.buckets) {
    delete state.aws.buckets[environmentName];
  }
  if (state.aws?.iamUsers) {
    delete state.aws.iamUsers[environmentName];
  }
  if (state.railway?.services) {
    delete state.railway.services[environmentName];
  }
  if (state.jwt) {
    delete state.jwt[environmentName];
  }
  if (state.migrations) {
    delete state.migrations[environmentName];
  }
  if (state.seeded) {
    delete state.seeded[environmentName];
  }
}

export async function runRevertAll(): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();
  const environments = getEnvironmentNames(config);

  logger.banner(config.project.displayName, environments);

  const environmentName = await askEnvironment(environments);
  if (!environmentName) {
    logger.info('Aborted.');
    return;
  }

  const revertList = buildRevertListForEnvironment(environmentName, config, state);

  if (revertList.length === 0) {
    logger.info(`No provisioned resources found for environment "${environmentName}".`);
    return;
  }

  logger.blank();
  logger.revertReview(revertList);

  const first = await confirm(
    `Revert environment "${environmentName}"? (all services above will be deleted)`,
  );
  if (!first) {
    logger.info('Aborted.');
    return;
  }

  logger.blank();
  const second = await confirm('FINAL CONFIRMATION: This cannot be undone. Proceed?');
  if (!second) {
    logger.info('Aborted.');
    return;
  }

  logger.blank();

  if (config.providers.railway.enabled && state.railway?.services?.[environmentName]) {
    await railwayProvider.destroyEnvironment(environmentName, state, secrets.railway.token);
  }

  if (
    config.providers.aws.enabled &&
    (state.aws?.buckets?.[environmentName] || state.aws?.iamUsers?.[environmentName])
  ) {
    await awsProvider.destroyEnvironment(environmentName, state, secrets);
  }

  if (config.providers.neon.enabled && state.neon?.branches?.[environmentName]) {
    const branch = state.neon.branches[environmentName];
    if (branch.branchId === 'main') {
      await neonProvider.destroy(state, secrets);
      state.neon = undefined;
    } else {
      await neonProvider.destroyEnvironment(environmentName, state, secrets);
    }
  }

  removeEnvironmentFromState(state, environmentName);

  if (state.neon?.branches && Object.keys(state.neon.branches).length === 0) {
    state.neon = undefined;
  }
  if (state.redis?.databases && Object.keys(state.redis.databases).length === 0) {
    state.redis = undefined;
  }
  if (
    state.aws?.buckets &&
    Object.keys(state.aws?.buckets).length === 0 &&
    state.aws?.iamUsers &&
    Object.keys(state.aws.iamUsers).length === 0
  ) {
    state.aws = undefined;
  }
  if (state.railway?.services && Object.keys(state.railway.services).length === 0) {
    state.railway = undefined;
  }

  saveState(state);
  logger.blank();
  logger.success(`Environment "${environmentName}" reverted. State updated.`);
}
