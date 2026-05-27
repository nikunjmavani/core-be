import { execSync, spawnSync } from 'node:child_process';
import * as logger from '../../../common/logger.js';
import { buildEnvironmentVariables } from '../../../envs/build-env-vars.js';
import { runGithubInit } from '../../../github/init.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

/**
 * Maps short CLI aliases (`dev`, `prod`) to canonical full GitHub Environment
 * names (`development`, `production`). Always use full names downstream — the
 * `gh secret set --env <name>` calls and the `.github/environments/*.json`
 * files are keyed by the canonical name.
 */
const GITHUB_ENV_MAP: Record<string, string> = {
  dev: 'development',
  development: 'development',
  prod: 'production',
  production: 'production',
};

function formatGitHubEnvironmentPlan(config: SetupConfig): string {
  return config.environments
    .map(
      (environment) =>
        `${environment.name} (${environment.label}; branch ${environment.branch}; Railway services: api, worker, redis)`,
    )
    .join(', ');
}

function ghCommand(command: string): string {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    }).trim();
  } catch (executionError: unknown) {
    const message =
      executionError instanceof Error ? executionError.message : String(executionError);
    throw new Error(`GitHub CLI failed: ${message}`);
  }
}

function setGitHubSecret(
  repository: string,
  secretName: string,
  secretValue: string,
  environment?: string,
): void {
  const args = ['secret', 'set', secretName, '--repo', repository];
  if (environment) args.push('--env', environment);
  const result = spawnSync('gh', args, {
    input: secretValue,
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? '';
    throw new Error(`Failed to set GitHub secret "${secretName}": ${stderr}`);
  }
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
  environments: string[],
): Promise<ProviderResult> {
  const repository = config.providers.github.repository;
  const spinner = logger.startSpinner('Setting GitHub repository and environment secrets...');

  try {
    ghCommand(`gh repo view ${repository} --json name`);
    logger.stopSpinner(spinner, `GitHub repository "${repository}" accessible`);

    const setSecretNames: string[] = [];

    // Repository-level secrets (single value, not env-scoped).
    // Note: Per-environment deploy-provider IDs (RAILWAY_SERVICE_ID,
    // RAILWAY_WORKER_SERVICE_ID) and third-party publishing secrets
    // (POSTMAN_API_KEY, POSTMAN_WORKSPACE_ID) flow through the per-environment
    // loop below via `buildEnvironmentVariables()` so each GitHub Environment
    // resolves them via `${{ secrets.* }}` independently.
    if (secrets.railway.token) {
      const secretSpinner = logger.startSpinner('Setting RAILWAY_TOKEN (repo)...');
      setGitHubSecret(repository, 'RAILWAY_TOKEN', secrets.railway.token);
      logger.stopSpinner(secretSpinner, 'RAILWAY_TOKEN set');
      setSecretNames.push('RAILWAY_TOKEN');
    }

    // Per-environment secrets (GitHub Environments: development, production)
    for (const environmentName of environments) {
      const ghEnv = GITHUB_ENV_MAP[environmentName] ?? environmentName;
      const railwayEnvironment = state.railway?.environments?.[environmentName];
      const apiServiceId = railwayEnvironment?.services.api?.serviceId;
      const workerServiceId = railwayEnvironment?.services.worker?.serviceId;
      const envVars = buildEnvironmentVariables(environmentName, config, secrets, state);

      logger.info(
        `GitHub Environment "${ghEnv}" maps branch "${config.environments.find((environment) => environment.name === environmentName)?.branch ?? environmentName}" and Railway services: api${apiServiceId ? ` (${apiServiceId})` : ''}, worker${workerServiceId ? ` (${workerServiceId})` : ''}.`,
      );

      const envSecrets: Array<{ name: string; value: string }> = [];
      for (const [key, value] of Object.entries(envVars)) {
        if (value !== undefined && value !== '') {
          envSecrets.push({ name: key, value });
        }
      }

      for (const secret of envSecrets) {
        const secretSpinner = logger.startSpinner(`Setting ${secret.name} (env: ${ghEnv})...`);
        try {
          setGitHubSecret(repository, secret.name, secret.value, ghEnv);
          logger.stopSpinner(secretSpinner, `${secret.name} set`);
          setSecretNames.push(`${secret.name}@${ghEnv}`);
        } catch (setError) {
          const message = setError instanceof Error ? setError.message : String(setError);
          logger.stopSpinner(secretSpinner, `Failed to set "${secret.name}": ${message}`, 'fail');
        }
      }
    }

    return {
      success: true,
      message: `GitHub: ${setSecretNames.length} secrets set`,
      stateUpdates: { github: { repository, secrets: setSecretNames } },
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.error(`GitHub provisioning failed: ${message}`);
    return { success: false, message };
  }
}

export async function check(state: SetupState, config?: SetupConfig): Promise<boolean> {
  const repository = state.github?.repository ?? config?.providers.github.repository;
  if (!repository) {
    logger.error('GitHub: no repository configured');
    return false;
  }

  try {
    ghCommand(`gh repo view ${repository} --json name`);
    logger.success(`GitHub repository "${repository}" — accessible`);
    return true;
  } catch {
    logger.error(`GitHub repository "${repository}" — inaccessible`);
    return false;
  }
}

function githubTokenPresentInEnvironment(): boolean {
  return Boolean((process.env.GITHUB_TOKEN ?? '').trim() || (process.env.GH_TOKEN ?? '').trim());
}

export async function syncGithubFoundations(): Promise<void> {
  logger.info('Syncing GitHub branches, rulesets, and environments...');
  const initResult = await runGithubInit({
    mode: 'sync',
    purpose: 'Setup infra: branches, rulesets, and GitHub Environments',
    skipPreflight: githubTokenPresentInEnvironment(),
  });
  if (initResult.failures > 0) {
    logger.warn(
      `GitHub branch/ruleset/environment sync reported ${initResult.failures} failure(s). ` +
        'Common cause: repository rulesets need GitHub Pro on private repos. ' +
        'Re-run `pnpm github:sync` after upgrading or making the repo public.',
    );
    return;
  }
  logger.success('GitHub branches, rulesets, and environments are in sync.');
}

export const setupGithubProvider: InfraProvider = {
  key: 'github',
  name: 'GitHub (branches, rulesets, environments, secrets)',
  isEnabled: ({ config }) => config.providers.github.enabled,
  disabledReason: () => 'GitHub provider disabled in setup.config.json',
  preview: ({ config }) =>
    config.providers.github.enabled
      ? {
          detail:
            'GITHUB_TOKEN — repo/env secrets (no gh auth login when set). See docs/deployment/setup/setup-token-instructions.md',
          url: 'https://github.com/settings/tokens',
          configKey: 'GITHUB_TOKEN',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.github.enabled
      ? [
          {
            bucket: 'resource',
            provider: 'GitHub',
            detail: `repository "${config.providers.github.repository}" + branches/rulesets + environments (${formatGitHubEnvironmentPlan(config)})`,
          },
        ]
      : [],
  buildStep: (context: InfraProviderContext) => ({
    name: 'GitHub (branches, rulesets, environments, secrets)',
    enabled: setupGithubProvider.isEnabled(context),
    enabledReason: setupGithubProvider.disabledReason(context),
    instructions: [
      `Will sync repository "${context.config.providers.github.repository}" branches, rulesets, and GitHub Environments.`,
      `Branch/environment plan: ${formatGitHubEnvironmentPlan(context.config)}.`,
      'Will push environment-scoped secrets and variables per environment, including RAILWAY_SERVICE_ID, RAILWAY_WORKER_SERVICE_ID, POSTMAN_API_KEY, and POSTMAN_WORKSPACE_ID when their respective state/secrets are available.',
    ],
    execute: async () => {
      await syncGithubFoundations();
      const result = await provision(
        context.config,
        context.secrets,
        context.state,
        context.environments,
      );
      if (!result.success) throw new Error(result.message);
      context.applyStateUpdates(result.stateUpdates ?? {});
      return result;
    },
    verifyState: () => ({
      ok: Boolean(context.state.github?.secrets?.length),
      message: context.state.github
        ? `${context.state.github.secrets.length} secrets synced for ${context.state.github.repository}`
        : 'no GitHub secrets recorded',
    }),
    verifyLive: async () => {
      const ok = await check(context.state, context.config);
      return { ok, message: ok ? 'reachable' : 'unreachable' };
    },
  }),
  detectRemote: async ({ config, state }) => {
    const resources: Record<string, unknown> = {};
    try {
      const repository = config.providers.github.repository;
      execSync(`gh api repos/${repository} --jq '.name'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10_000,
      });
      resources.repository = repository;
    } catch {
      // repository not accessible, skip
    }
    if (Object.keys(resources).length > 0) {
      Object.assign(state, { github: resources });
    }
    return resources;
  },
  check: ({ state, config }) => check(state, config),
  deleteInstructions: ({ state, config }) => {
    const repository = state.github?.repository ?? config.providers.github.repository;
    if (!repository) return [];
    const secrets = state.github?.secrets ?? [];
    const environments = config.environments.map((environment) => environment.name);
    return [
      {
        provider: 'GitHub (environments + secrets + rulesets)',
        dashboardUrl: `https://github.com/${repository}/settings/environments`,
        steps: [
          'Settings → Environments → delete each environment listed below.',
          'Settings → Secrets and variables → Actions → remove repo and environment secrets you no longer need.',
          'Settings → Rules / Branches → remove the branch rulesets pushed by setup:infra.',
          'The repository itself is intentionally not deleted by these instructions; remove it from Settings → Danger Zone if you really want to drop it.',
        ],
        resources: [
          { label: 'Repository', identifier: repository },
          ...environments.map((environmentName) => ({
            label: 'Environment',
            identifier: environmentName,
          })),
          ...(secrets.length > 0
            ? [{ label: 'Synced secrets', identifier: secrets.join(', ') }]
            : []),
        ],
      },
    ];
  },
};
