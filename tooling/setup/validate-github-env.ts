import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  driftResultsHaveIssues,
  validateGitHubEnvironmentsDrift,
} from './github-environments.js';

const ENV_EXAMPLE_PATH = resolve(import.meta.dirname, '../../.env.example');

/**
 * GitHub Environments that map to hosted deployments. Each one must carry an explicit
 * Postgres connection budget so `assertPostgresConnectionBudget()` can validate sizing
 * against `max_connections` at API/worker startup.
 */
const DEPLOYMENT_COUNT_REQUIRED_ENVIRONMENTS = new Set<string>(['dev', 'qa', 'production']);

export type DeploymentCountIssue =
  | { readonly kind: 'missing' }
  | { readonly kind: 'partial-split'; readonly present: string };

/**
 * Apply the either-or rule used by `assertPostgresConnectionBudget`:
 * `DEPLOYMENT_PROCESS_COUNT` OR both `DEPLOYMENT_API_PROCESS_COUNT` and
 * `DEPLOYMENT_WORKER_PROCESS_COUNT` must be present in the environment secrets.
 */
export function validateDeploymentProcessCountSecrets(
  environment: string,
  secretNames: readonly string[],
): DeploymentCountIssue | undefined {
  if (!DEPLOYMENT_COUNT_REQUIRED_ENVIRONMENTS.has(environment)) {
    return undefined;
  }

  const secrets = new Set(secretNames);
  const hasTotal = secrets.has('DEPLOYMENT_PROCESS_COUNT');
  const hasApi = secrets.has('DEPLOYMENT_API_PROCESS_COUNT');
  const hasWorker = secrets.has('DEPLOYMENT_WORKER_PROCESS_COUNT');

  if (hasTotal || (hasApi && hasWorker)) {
    return undefined;
  }

  if (hasApi !== hasWorker) {
    return { kind: 'partial-split', present: hasApi ? 'API' : 'WORKER' };
  }

  return { kind: 'missing' };
}

function parseRequiredVariables(): string[] {
  const content = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
  const variables: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=/);
    if (match?.[1]) {
      variables.push(match[1]);
    }
  }

  return variables;
}

function getGitHubEnvironmentSecretNames(environment: string): string[] {
  try {
    const output = execSync(
      `gh api repos/:owner/:repo/environments/${environment}/secrets --jq '.secrets[].name'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 },
    );
    return output
      .trim()
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean);
  } catch (commandError) {
    const message = commandError instanceof Error ? commandError.message : String(commandError);
    throw new Error(`Failed to fetch GitHub environment secrets for "${environment}": ${message}`);
  }
}

function validateGitHubEnvironmentProtectionDrift(): boolean {
  const results = validateGitHubEnvironmentsDrift();
  if (!driftResultsHaveIssues(results)) {
    return true;
  }

  console.error(
    'GitHub environment protection drift: update GitHub UI or edit .github/environments/*.json so they match.',
  );
  console.error('See docs/deployment/github-production-environment.md');
  console.error('');
  return false;
}

function main(): void {
  const skipGitHub = process.env.SKIP_GITHUB_ENV === '1' || process.env.SKIP_GITHUB_ENV === 'true';
  if (!skipGitHub && !validateGitHubEnvironmentProtectionDrift()) {
    process.exit(1);
  }

  if (skipGitHub) {
    console.log('SKIP_GITHUB_ENV set — skipping GitHub environment protection drift check.');
    console.log('');
  }

  const config = process.env['CONFIG'] ?? 'dev';
  const ghEnvMap: Record<string, string> = {
    dev: 'dev',
    qa: 'qa',
    prod: 'production',
    production: 'production',
  };
  const environment = ghEnvMap[config] ?? config;

  console.log(`Validating GitHub environment: ${environment}`);
  console.log('Required variables source: .env.example');
  console.log('');

  const requiredVariables = parseRequiredVariables();
  console.log(`Required variables: ${requiredVariables.length}`);

  let ghVariables: string[];
  try {
    ghVariables = getGitHubEnvironmentSecretNames(environment);
  } catch (fetchError) {
    console.error(fetchError instanceof Error ? fetchError.message : String(fetchError));
    process.exit(1);
  }

  console.log(`GitHub environment variables: ${ghVariables.length}`);
  console.log('');

  const missingVariables = requiredVariables.filter((variable) => !ghVariables.includes(variable));
  const deploymentCountIssue = validateDeploymentProcessCountSecrets(environment, ghVariables);

  if (missingVariables.length === 0 && deploymentCountIssue === undefined) {
    console.log(
      `All ${requiredVariables.length} required variables are present in GitHub environment "${environment}".`,
    );
    process.exit(0);
  }

  if (missingVariables.length > 0) {
    console.error(
      `${missingVariables.length} required variable(s) missing from GitHub environment "${environment}":`,
    );
    console.log('');

    for (const variable of missingVariables) {
      console.error(`  ${variable}`);
    }

    console.log('');
  }

  if (deploymentCountIssue !== undefined) {
    if (deploymentCountIssue.kind === 'partial-split') {
      console.error(
        `GitHub environment "${environment}" sets DEPLOYMENT_${deploymentCountIssue.present}_PROCESS_COUNT ` +
          'without its counterpart. Set both DEPLOYMENT_API_PROCESS_COUNT and DEPLOYMENT_WORKER_PROCESS_COUNT, ' +
          'or use the DEPLOYMENT_PROCESS_COUNT shorthand instead.',
      );
    } else {
      console.error(
        `GitHub environment "${environment}" is missing the Postgres connection-budget secret(s). ` +
          'Set DEPLOYMENT_PROCESS_COUNT (api_replicas + worker_replicas) or both ' +
          'DEPLOYMENT_API_PROCESS_COUNT and DEPLOYMENT_WORKER_PROCESS_COUNT so deploy-railway.yml ' +
          'forwards them and assertPostgresConnectionBudget() can validate sizing at startup.',
      );
    }
    console.log('');
    console.log('See docs/deployment/runbooks/resource-limits.md');
    console.log('');
  }

  console.log(
    'To fix, add secrets in GitHub: Settings → Environments →',
    environment,
    '→ Environment secrets',
  );
  console.log('');

  process.exit(1);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
