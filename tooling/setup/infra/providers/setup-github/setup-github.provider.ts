/**
 * GitHub provider for `pnpm setup:infra`.
 *
 * Scaffolds the repo, branches, and rulesets, and pushes each `.env.<environment>` to the
 * matching GitHub Environment secrets.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*` (+ `providers.github.repository`), environment names from
 * `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; `.setup-state.json` is gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import { execSync } from 'node:child_process';
import { runCommand } from '@tooling/setup/common/exec.js';
import * as logger from '@tooling/setup/common/logger.js';
import { runGithubInit } from '@tooling/setup/github/init.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '@tooling/setup/common/types.js';

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

/**
 * GitHub repo-level setup is a verify-and-record step. No secrets are pushed here —
 * the Railway provider mints per-environment project tokens, persists them in state,
 * `exportEnvFiles` writes each into the matching `.env.<env>` as `RAILWAY_TOKEN`, and
 * the dedicated GitHub-sync step (`buildGitHubSyncStep` → `syncEnvironmentToGitHub`)
 * reads each `.env.<environment>`, classifies keys as secret-vs-variable via the
 * central `classifyKey` rules, and pushes them per GitHub Environment. So
 * `${{ secrets.RAILWAY_TOKEN }}` in the deploy workflow resolves to the env-scoped
 * token automatically.
 *
 * Pushing env-scoped items here as well would create the same key under both Secrets
 * and Variables in a GitHub Environment.
 */
export async function provision(
  config: SetupConfig,
  _secrets: SetupSecrets,
  _state: SetupState,
  _environments: string[],
): Promise<ProviderResult> {
  const repository = config.providers.github.repository;
  const spinner = logger.startSpinner('Verifying GitHub repository access...');

  try {
    ghCommand(`gh repo view ${repository} --json name`);
    logger.stopSpinner(spinner, `GitHub repository "${repository}" accessible`);

    logger.info(
      'Environment-scoped secrets and variables will be pushed by the GitHub sync step (after .env.<environment> export).',
    );

    return {
      success: true,
      message: 'GitHub: repository access verified',
      stateUpdates: { github: { repository, secrets: [] } },
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
  describe: ({ config, environments }) => {
    const [owner = '', repository = ''] = config.providers.github.repository.split('/');
    return { organization: owner, project: repository, environments };
  },
  inspectRemote: ({ config, environments }) => {
    const repository = config.providers.github.repository;
    const [owner = '', repo = ''] = repository.split('/');
    const repoResult = runCommand('gh', {
      args: ['api', `repos/${repository}`, '--jq', '.full_name'],
      allowFailure: true,
    });
    if (repoResult.status !== 0) {
      return Promise.resolve({
        present: false,
        fields: [
          {
            label: 'repository',
            expected: repository,
            remote: '—',
            matches: false,
            prerequisite: true,
          },
        ],
        error: repoResult.stderr.trim() || 'repository not found / gh not authenticated',
      });
    }
    const [remoteOwner = '', remoteRepo = ''] = repoResult.stdout.trim().split('/');
    const fields = [
      {
        label: 'owner',
        expected: owner,
        remote: remoteOwner || '—',
        matches: remoteOwner === owner,
        prerequisite: true,
      },
      {
        label: 'repository',
        expected: repo,
        remote: remoteRepo || '—',
        matches: remoteRepo === repo,
      },
    ];
    const envResult = runCommand('gh', {
      args: ['api', `repos/${repository}/environments`, '--jq', '.environments[].name'],
      allowFailure: true,
    });
    const remoteEnvironments = new Set(
      envResult.status === 0 ? envResult.stdout.trim().split('\n').filter(Boolean) : [],
    );
    for (const environmentName of environments) {
      const present = remoteEnvironments.has(environmentName);
      fields.push({
        label: `environment (${environmentName})`,
        expected: environmentName,
        remote: present ? environmentName : '—',
        matches: present,
      });
    }
    return Promise.resolve({ present: true, fields });
  },
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
      ok: Boolean(context.state.github?.repository),
      message: context.state.github?.repository
        ? `repository ${context.state.github.repository} verified (env-scoped secrets pushed by the GitHub sync step)`
        : 'no GitHub repository recorded',
    }),
    verifyLive: async () => {
      const ok = await check(context.state, context.config);
      return { ok, message: ok ? 'reachable' : 'unreachable' };
    },
  }),
  detectRemote: async ({ config, state, applyStateUpdates }) => {
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
      // Merge into existing github state — the schema requires `secrets:
      // string[]` and overwriting with just { repository } would invalidate
      // the file and force a "starting fresh" wipe on the next loadState.
      const repository = resources.repository as string | undefined;
      applyStateUpdates({
        github: {
          repository: repository ?? state.github?.repository ?? config.providers.github.repository,
          secrets: state.github?.secrets ?? [],
        },
      });
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
