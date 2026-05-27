import { execSync, spawnSync } from 'node:child_process';
import * as logger from '../../../common/logger.js';
import { runGithubInit } from '../../../github/init.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

function formatGitHubEnvironmentPlan(config: SetupConfig): string {
  return config.environments
    .map(
      (environment) =>
        `${environment.name} (${environment.label}; branch ${environment.branch}; Railway services: api, worker + redis database)`,
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

function setRepositorySecret(repository: string, secretName: string, secretValue: string): void {
  const result = spawnSync('gh', ['secret', 'set', secretName, '--repo', repository], {
    input: secretValue,
    encoding: 'utf-8',
    timeout: 15000,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? '';
    throw new Error(`Failed to set GitHub secret "${secretName}": ${stderr}`);
  }
}

/**
 * Pushes only the repository-level RAILWAY_TOKEN secret. All env-scoped
 * secrets and variables (DATABASE_URL, REDIS_URL, RAILWAY_SERVICE_ID,
 * RAILWAY_WORKER_SERVICE_ID, POSTMAN_*, ALLOWED_ORIGINS, etc.) are pushed by
 * the dedicated GitHub-sync step (`buildGitHubSyncStep` →
 * `syncEnvironmentToGitHub`) which reads `.env.<environment>`, classifies
 * each key as secret-vs-variable via the central `classifyKey` rules, and
 * prunes stale items.
 *
 * Pushing env-scoped items here as well would create the same key under both
 * Secrets and Variables in a GitHub Environment (e.g. ALLOWED_ORIGINS as a
 * Secret here, then again as a Variable in the sync step).
 */
export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  _state: SetupState,
  _environments: string[],
): Promise<ProviderResult> {
  const repository = config.providers.github.repository;
  const spinner = logger.startSpinner('Setting GitHub repository-level secrets...');

  try {
    ghCommand(`gh repo view ${repository} --json name`);
    logger.stopSpinner(spinner, `GitHub repository "${repository}" accessible`);

    const setSecretNames: string[] = [];

    if (secrets.railway.token) {
      const secretSpinner = logger.startSpinner('Setting RAILWAY_TOKEN (repo)...');
      setRepositorySecret(repository, 'RAILWAY_TOKEN', secrets.railway.token);
      logger.stopSpinner(secretSpinner, 'RAILWAY_TOKEN set');
      setSecretNames.push('RAILWAY_TOKEN');
    }

    logger.info(
      'Environment-scoped secrets and variables will be pushed by the GitHub sync step (after .env.<environment> export).',
    );

    return {
      success: true,
      message: `GitHub: ${setSecretNames.length} repo-level secret(s) set`,
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
      'Will push the repository-level RAILWAY_TOKEN secret only. Environment-scoped secrets and variables (RAILWAY_SERVICE_ID, RAILWAY_WORKER_SERVICE_ID, POSTMAN_*, app config) are pushed by the subsequent GitHub sync step after `.env.<environment>` is exported.',
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
