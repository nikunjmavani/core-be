import { createInterface } from 'node:readline';
import * as logger from '../common/logger.js';
import { loadConfig, getEnvironmentNames, getConfigPath } from '../common/config.js';
import { loadSecrets, getSecretsPath, ensureEnvSetupTemplate } from '../common/secrets.js';
import { hasAnyEnvSecret } from '../common/secrets.js';
import { loadState, saveState, stateFileExists } from '../common/state.js';
import { checkPrerequisites } from './prerequisites.js';
import { runGuide } from './guide.js';
import { exportEnvFiles } from '../envs/export-env-files.js';
import { INFRA_PROVIDERS } from './providers/index.js';
import {
  syncGithubFoundations,
  provision as githubProvision,
} from './providers/setup-github/setup-github.provider.js';
import {
  runInteractiveStep,
  summarizeOutcomes,
  type StepDescriptor,
  type StepOutcome,
} from '../common/interactive-step.js';
import { reviewProjectIdentity, SETUP_SERVICE_NAMES } from './identity-review.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  InfraProviderContext,
} from '../common/types.js';

export interface ProvisionOptions {
  assumeYes?: boolean;
}

function buildProviderContext(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
  environments: string[],
): InfraProviderContext {
  return {
    config,
    secrets,
    state,
    environments,
    applyStateUpdates: (updates) => {
      Object.assign(state, updates);
      saveState(state);
    },
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getEnvironmentBranchEntries(config: SetupConfig): logger.EnvironmentBranchEntry[] {
  return config.environments.map((environment) => ({
    name: environment.name,
    label: environment.label,
    branch: environment.branch,
    services: SETUP_SERVICE_NAMES,
    isDefault: environment.isDefault,
  }));
}

function showHeader(config: SetupConfig, environments: string[]): void {
  logger.banner(config.project.displayName, environments);
  logger.environmentBranchMapping(getEnvironmentBranchEntries(config));
}

async function confirm(message: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    readline.question(`  ${message} (y/N): `, (answer) => {
      readline.close();
      resolvePromise(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function confirmBranchProceed(config: SetupConfig): Promise<boolean> {
  const entries = getEnvironmentBranchEntries(config);
  const summaryLine = entries
    .map((entry) => `${entry.branch} → ${entry.name} (${entry.services?.join(', ')})`)
    .join(', ');
  logger.info(
    `Setup will affect ${entries.length} branch${entries.length === 1 ? '' : 'es'} (1 branch = 1 environment; each environment gets api + worker): ${summaryLine}.`,
  );
  return confirm('Proceed with these branches/environments?');
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

function isAssumeYes(options: ProvisionOptions | undefined): boolean {
  return options?.assumeYes === true;
}

// ─── SETTINGS REVIEW ────────────────────────────────────────────────────────

function displaySettingsReview(config: SetupConfig, context: InfraProviderContext): void {
  const resources: Array<{ provider: string; detail: string }> = [];
  const extras: Array<{ provider: string; detail: string }> = [];

  for (const provider of INFRA_PROVIDERS) {
    const entries = provider.settingsReview?.(context) ?? [];
    for (const entry of entries) {
      if (entry.bucket === 'resource') {
        resources.push({ provider: entry.provider, detail: entry.detail });
      } else {
        extras.push({ provider: entry.provider, detail: entry.detail });
      }
    }
  }

  logger.settingsReview(
    config.project.name,
    config.project.organization,
    getEnvironmentBranchEntries(config),
    resources,
    extras,
  );
}

// ─── PRE-EXISTENCE CHECK ────────────────────────────────────────────────────

async function checkForExistingResources(
  context: InfraProviderContext,
): Promise<Array<{ provider: string; detail: string }>> {
  const existing: Array<{ provider: string; detail: string }> = [];

  logger.info('Checking for existing resources...');
  logger.blank();

  for (const provider of INFRA_PROVIDERS) {
    if (!provider.detectExisting) continue;
    const found = await provider.detectExisting(context);
    existing.push(...found);
  }

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

// ─── POST-PROVISION ENV OUTPUT PROMPT ────────────────────────────────────────

async function promptEnvOutput(
  environments: string[],
  options: ProvisionOptions = {},
): Promise<void> {
  if (isAssumeYes(options)) {
    logger.blank();
    logger.info('.env files were exported and synced to GitHub as part of the provisioning steps.');
    return;
  }

  logger.blank();
  logger.divider();
  console.log('');
  console.log('  Provisioning complete. Values for', environments.length, 'environment(s) ready.');
  console.log('');
  console.log('  .env.<environment> files were created from .env.example and populated');
  console.log('  with provisioned values. If GitHub is enabled, they were also pushed');
  console.log('  to GitHub Environment secrets and variables.');
  console.log('');
  console.log('  Re-run pnpm setup:envs or pnpm setup:github at any time to refresh.');
}

// ─── PREVIEW ────────────────────────────────────────────────────────────────

export function runPreview(): void {
  const config = loadConfig();
  const environments = getEnvironmentNames(config);
  const secrets = loadSecrets(config);
  const state = loadState();
  const context = buildProviderContext(config, secrets, state, environments);

  showHeader(config, environments);

  const configPath = getConfigPath();
  const secretsPath = getSecretsPath();

  if (ensureEnvSetupTemplate(config)) {
    logger.info(
      'Generated .env.setup template — fill values and run pnpm setup --preview or setup:infra again.',
    );
  }

  const previewEntries: Array<{
    provider: string;
    detail: string;
    url: string;
    configKey: string;
  }> = [];
  for (const provider of INFRA_PROVIDERS) {
    const entry = provider.preview?.(context);
    if (!entry) continue;
    previewEntries.push({
      provider: provider.name,
      detail: entry.detail,
      url: entry.url,
      configKey: entry.configKey,
    });
  }

  logger.previewPlan(configPath, secretsPath, previewEntries);
}

// ─── PROVISION ──────────────────────────────────────────────────────────────

export async function runProvision(options: ProvisionOptions = {}): Promise<void> {
  const config = await reviewProjectIdentity({ assumeYes: isAssumeYes(options) });
  const environments = getEnvironmentNames(config);

  showHeader(config, environments);

  if (!isAssumeYes(options)) {
    const branchOk = await confirmBranchProceed(config);
    if (!branchOk) {
      logger.blank();
      logger.info('Aborted. No resources were created.');
      process.exit(0);
    }
    logger.blank();
  }

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

  await runGuide(config);

  const secrets = loadSecrets(config);
  const state = loadState();
  const context = buildProviderContext(config, secrets, state, environments);

  if (!hasAnyEnvSecret(environments)) {
    logger.error(
      'No secrets found. Fill .env.setup with your API keys (each variable has a comment with the URL to get it).',
    );
    logger.info('Then run pnpm setup:infra again.');
    process.exit(1);
  }

  displaySettingsReview(config, context);

  const confirmed = isAssumeYes(options) ? true : await doubleConfirm();
  if (!confirmed) {
    logger.blank();
    logger.info('Aborted. No resources were created.');
    process.exit(0);
  }

  logger.blank();

  const existingResources = await checkForExistingResources(context);
  if (existingResources.length > 0) {
    logger.existingResourcesError(existingResources);
    logger.warn('Existing resources will be adopted or skipped by provider-specific setup.');
  } else {
    logger.success('No existing resources found — safe to proceed.');
  }

  logger.blank();

  // Build the ordered step list: every provider contributes one step, followed
  // by the env-file export and (when GitHub is enabled) the GitHub sync step.
  // Database migrations and seeding are intentionally NOT part of setup:infra —
  // they run from CD against each provisioned environment.
  const steps: StepDescriptor<unknown>[] = INFRA_PROVIDERS.map((provider) =>
    provider.buildStep(context),
  );
  steps.push(buildExportEnvFilesStep(environments));
  const githubSyncStep = buildGitHubSyncStep(context);
  if (githubSyncStep) steps.push(githubSyncStep);

  const totalSteps = steps.length;
  const outcomes: StepOutcome<unknown>[] = [];

  for (let index = 0; index < steps.length; index += 1) {
    const outcome = await runInteractiveStep(index + 1, totalSteps, steps[index], {
      assumeYes: isAssumeYes(options),
    });
    outcomes.push(outcome);
    if (outcome.status === 'aborted') {
      logger.blank();
      logger.warn('Aborting setup at user request. State so far is saved.');
      logger.info(
        'No rollback is performed. Run "pnpm setup:infra --delete" to see dashboard URLs for any partial resources you want to remove manually.',
      );
      printOutcomeSummary(outcomes);
      process.exit(1);
    }
  }

  logger.divider();
  logger.blank();
  printOutcomeSummary(outcomes);
  const { hasFailures } = summarizeOutcomes(outcomes);
  if (hasFailures) {
    logger.warn('Setup finished with some failures (see table above).');
    logger.info(
      'No rollback is performed. Run "pnpm setup:infra --delete" to see dashboard URLs for any partial resources you want to remove manually, then re-run "pnpm setup:infra".',
    );
    process.exitCode = 1;
  } else {
    logger.success('Setup completed successfully! All resources provisioned.');
  }

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
    for (const [environmentName, environmentState] of Object.entries(
      state.railway.environments ?? {},
    )) {
      const services = SETUP_SERVICE_NAMES.map((serviceName) => {
        const serviceId = environmentState.services[serviceName]?.serviceId ?? 'missing';
        return `${serviceName}:${serviceId}`;
      }).join(', ');
      summaryItems.push({ label: `  ${environmentName} services`, value: services });
    }
  }

  if (state.github?.secrets?.length) {
    summaryItems.push({ label: 'GitHub Secrets', value: state.github.secrets.join(', ') });
  }

  if (summaryItems.length > 0) {
    logger.summary('Provisioned Resources', summaryItems);
  }

  // Post-provision: ask what to do with env files
  await promptEnvOutput(environments, options);
}

// ─── CROSS-CUTTING STEPS (env-file export, GitHub sync) ─────────────────────
//
// These are not third-party providers and therefore not in `INFRA_PROVIDERS`,
// but they share the same StepDescriptor shape so they slot into the loop.

function buildExportEnvFilesStep(environments: string[]): StepDescriptor<unknown> {
  return {
    name: 'Export .env.<environment> files',
    enabled: true,
    instructions: [
      `Will copy .env.example → .env.${environments.join(', .env.')} and replace known values from provisioned state.`,
      'Existing files are skipped to preserve local edits. These files are gitignored.',
    ],
    execute: async () => {
      const result = exportEnvFiles();
      if (result.written.length > 0) {
        logger.success(`Created ${result.written.length} file(s): ${result.written.join(', ')}`);
      }
      if (result.merged.length > 0) {
        logger.info(
          `Regenerated ${result.merged.length} existing file(s) with all .env.example keys: ${result.merged.join(', ')}`,
        );
      }
      return result;
    },
    verifyState: () => ({ ok: true, message: 'env files exported' }),
  };
}

function buildGitHubSyncStep(context: InfraProviderContext): StepDescriptor<unknown> | null {
  if (!context.config.providers.github.enabled) return null;

  return {
    name: 'Sync .env.<environment> to GitHub Environments',
    enabled: true,
    instructions: [
      `Will reconcile GitHub Environments against local .env files for: ${context.environments.join(', ')}.`,
      'Pushes all secrets and variables from each .env file. Deletes any item on GitHub that is NOT in the local file.',
      'Uses GITHUB_TOKEN from .env.setup. Secrets are encrypted; variables are diffed.',
    ],
    execute: async () => {
      const { syncEnvironmentToGitHub } = await import('../github/sync-github-environments.js');
      let totalPushed = 0;
      let totalSkipped = 0;
      let totalDeleted = 0;
      for (const env of context.environments) {
        const result = await syncEnvironmentToGitHub({
          environment: env,
          dryRun: false,
          skipCreate: false,
          skipPreflight: true,
        });
        totalPushed += result.pushed;
        totalSkipped += result.skipped;
        totalDeleted += result.deleted;
      }
      logger.success(
        `GitHub sync complete — pushed ${totalPushed}, skipped ${totalSkipped}, deleted ${totalDeleted}`,
      );
      return context.environments;
    },
    verifyState: () => ({ ok: true, message: 'GitHub sync complete' }),
  };
}

function printOutcomeSummary(outcomes: StepOutcome<unknown>[]): void {
  const { rows } = summarizeOutcomes(outcomes);
  logger.table(rows);
}

// ─── CHECK ──────────────────────────────────────────────────────────────────

export async function runCheck(): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();
  const environments = getEnvironmentNames(config);
  const context = buildProviderContext(config, secrets, state, environments);

  showHeader(config, environments);
  logger.info('Running health checks...');
  logger.blank();

  let allHealthy = true;

  for (const provider of INFRA_PROVIDERS) {
    if (!provider.check) continue;
    if (!provider.isEnabled(context)) continue;
    const healthy = await provider.check(context);
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

  showHeader(config, getEnvironmentNames(config));

  const rows: Array<{ env: string; status: string; detail: string }> = [];

  for (const environment of config.environments) {
    const neonOk = !!state.neon?.branches?.[environment.name]?.databaseUrl;
    const redisOk = config.providers.upstash.enabled
      ? !!state.redis?.databases?.[environment.name]?.redisUrl
      : true;
    const awsOk = !!state.aws?.buckets?.[environment.name];
    const jwtOk = !!state.jwt?.[environment.name];

    const allOk = neonOk && redisOk && awsOk && jwtOk;

    const details: string[] = [];
    if (!neonOk) details.push('Neon');
    if (!redisOk) details.push('Upstash');
    if (!awsOk) details.push('AWS');
    if (!jwtOk) details.push('JWT');

    rows.push({
      env: environment.name,
      status: allOk ? 'OK' : 'MISSING',
      detail: allOk
        ? `branch: ${environment.branch}; services: ${SETUP_SERVICE_NAMES.join(', ')}`
        : `branch: ${environment.branch}; missing: ${details.join(', ')}`,
    });
  }

  logger.table(rows);

  const sharedItems: Array<{ label: string; value: string }> = [];
  sharedItems.push({ label: 'Sentry', value: state.sentry ? 'configured' : 'not configured' });
  sharedItems.push({
    label: 'Railway',
    value: state.railway?.environments
      ? `${Object.keys(state.railway.environments).length} environments, ${Object.values(
          state.railway.environments,
        ).reduce(
          (count, environment) => count + Object.keys(environment.services).length,
          0,
        )} service attachments`
      : state.railway
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
  const context = buildProviderContext(config, secrets, state, environments);

  showHeader(config, environments);
  logger.info('Re-syncing GitHub (branches, rulesets, environments, secrets)...');
  logger.blank();

  if (config.providers.github.enabled) {
    await syncGithubFoundations();
    const result = await githubProvision(config, secrets, state, environments);
    context.applyStateUpdates(result.stateUpdates ?? {});
    if (result.success) {
      logger.success(result.message);
    } else {
      logger.error(result.message);
    }
  } else {
    logger.warn('GitHub is disabled in config. Nothing to update.');
  }
}

// ─── RECONSTRUCT ────────────────────────────────────────────────────────────

export async function runReconstruct(): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const environments = getEnvironmentNames(config);
  const state = loadState();

  showHeader(config, environments);
  logger.info('Reconstructing state from remote providers...');
  logger.blank();

  let foundCount = 0;

  for (const provider of INFRA_PROVIDERS) {
    if (
      !provider.isEnabled({ config, secrets, state, environments, applyStateUpdates: () => {} })
    ) {
      continue;
    }
    if (!provider.detectRemote) {
      logger.info(`${provider.name} — remote detection not available, skipping`);
      continue;
    }

    const spinner = logger.startSpinner(`Querying ${provider.name}...`);
    try {
      const resources = await provider.detectRemote({
        config,
        secrets,
        state,
        environments,
        applyStateUpdates: (updates: Partial<SetupState>) => Object.assign(state, updates),
      });
      const count = Object.keys(resources).length;
      foundCount += count;
      logger.stopSpinner(spinner, `${provider.name} — ${count} resource(s) found`);
    } catch (detectError) {
      const message = detectError instanceof Error ? detectError.message : String(detectError);
      logger.stopSpinner(spinner, `${provider.name} — failed: ${message}`, 'fail');
    }
  }

  saveState(state);
  logger.blank();
  if (foundCount > 0) {
    logger.success(`Rebuilt state with ${foundCount} resource(s) from remote.`);
  } else {
    logger.warn('No remote resources found. State unchanged.');
  }
}

// ─── DELETE INSTRUCTIONS ────────────────────────────────────────────────────
//
// `pnpm setup:infra --delete` is read-only: it never deletes resources. It
// loads `.setup-state.json` and prints, per provider, the dashboard URL and
// the identifiers the user must delete manually.

export function runDeleteInstructions(): void {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();
  const environments = getEnvironmentNames(config);
  const context = buildProviderContext(config, secrets, state, environments);

  showHeader(config, environments);

  const blocks = INFRA_PROVIDERS.flatMap((provider) =>
    (provider.deleteInstructions?.(context) ?? []).map((block) => ({
      provider: block.provider,
      dashboardUrl: block.dashboardUrl,
      steps: block.steps,
      resources: block.resources,
    })),
  );

  logger.deleteInstructionsReview(blocks);
}
