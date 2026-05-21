import { execSync, spawnSync } from 'node:child_process';
import * as logger from '../logger.util.js';
import { buildEnvironmentVariables } from '../build-env-vars.js';
import type { SetupConfig, SetupSecrets, SetupState, ProviderResult } from '../types.js';

const GITHUB_ENV_MAP: Record<string, string> = {
  dev: 'dev',
  qa: 'qa',
  prod: 'production',
  production: 'production',
};

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
  args.push('--body');
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

    // Repository-level secrets (shared across environments)
    if (secrets.railway.token) {
      const secretSpinner = logger.startSpinner('Setting RAILWAY_TOKEN (repo)...');
      setGitHubSecret(repository, 'RAILWAY_TOKEN', secrets.railway.token);
      logger.stopSpinner(secretSpinner, 'RAILWAY_TOKEN set');
      setSecretNames.push('RAILWAY_TOKEN');
    }

    if (secrets.postman?.apiKey) {
      setGitHubSecret(repository, 'POSTMAN_API_KEY', secrets.postman.apiKey);
      setSecretNames.push('POSTMAN_API_KEY');
    }
    if (secrets.postman?.workspaceId) {
      setGitHubSecret(repository, 'POSTMAN_WORKSPACE_ID', secrets.postman.workspaceId);
      setSecretNames.push('POSTMAN_WORKSPACE_ID');
    }

    // Per-environment secrets (GitHub Environments: dev, qa, production)
    const railwayServices = state.railway?.services ?? {};
    for (const environmentName of environments) {
      const ghEnv = GITHUB_ENV_MAP[environmentName] ?? environmentName;
      const serviceId = railwayServices[environmentName]?.serviceId;
      const envVars = buildEnvironmentVariables(environmentName, config, secrets, state);

      const envSecrets: Array<{ name: string; value: string }> = [];
      if (serviceId) {
        envSecrets.push({ name: 'RAILWAY_SERVICE_ID', value: serviceId });
      }
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

export async function check(state: SetupState): Promise<boolean> {
  if (!state.github?.repository) {
    logger.error('GitHub: no repository in state');
    return false;
  }

  try {
    ghCommand(`gh repo view ${state.github.repository} --json name`);
    logger.success(`GitHub repository "${state.github.repository}" — accessible`);
    return true;
  } catch {
    logger.error(`GitHub repository "${state.github.repository}" — inaccessible`);
    return false;
  }
}
