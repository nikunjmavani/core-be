import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  envSchemaConditionallyRequiredKeys,
  envSchemaRequiredKeys,
} from '@/shared/config/env-schema.js';
import { loadConfigIfExists } from '@tooling/setup/common/config.js';
import { driftResultsHaveIssues, validateGitHubEnvironmentsDrift } from './environments.js';

/**
 * GitHub Environments that map to hosted deployments. Each one must carry an explicit
 * Postgres connection budget so `assertPostgresConnectionBudget()` can validate sizing
 * against `max_connections` at API/worker startup.
 *
 * Canonical mapping (see docs/deployment/runbooks/add-new-environment.md):
 *   main branch → production
 *   dev branch  → development
 */
const DEPLOYMENT_COUNT_REQUIRED_ENVIRONMENTS = new Set<string>(['development', 'production']);

export type DeploymentCountIssue =
  | { readonly kind: 'missing' }
  | { readonly kind: 'partial-split'; readonly present: string };

export type RuntimeEnvironmentEntries = {
  readonly allPresent: string[];
  readonly variableValues: ReadonlyMap<string, string>;
};

/**
 * Apply the either-or rule used by `assertPostgresConnectionBudget`:
 * `DEPLOYMENT_TOTAL_REPLICA_COUNT` OR both `DEPLOYMENT_API_REPLICA_COUNT` and
 * `DEPLOYMENT_WORKER_REPLICA_COUNT` must be present in the environment secrets.
 */
export function validateDeploymentProcessCountSecrets(
  environment: string,
  secretNames: readonly string[],
): DeploymentCountIssue | undefined {
  if (!DEPLOYMENT_COUNT_REQUIRED_ENVIRONMENTS.has(environment)) {
    return undefined;
  }

  const secrets = new Set(secretNames);
  const hasTotal = secrets.has('DEPLOYMENT_TOTAL_REPLICA_COUNT');
  const hasApi = secrets.has('DEPLOYMENT_API_REPLICA_COUNT');
  const hasWorker = secrets.has('DEPLOYMENT_WORKER_REPLICA_COUNT');

  if (hasTotal || (hasApi && hasWorker)) {
    return undefined;
  }

  if (hasApi !== hasWorker) {
    return { kind: 'partial-split', present: hasApi ? 'API' : 'WORKER' };
  }

  return { kind: 'missing' };
}

/**
 * Required variables are sourced directly from the Zod env schema — any key without
 * `.optional()` and without `.default()`. This replaces the previous behavior of
 * treating every uncommented line in `.env.example` as required, which falsely flagged
 * optional integrations (Stripe, OAuth, S3) when they were not used.
 */
function getRequiredVariables(): string[] {
  return [...envSchemaRequiredKeys];
}

export function getRuntimeEnvironmentEntries(
  environmentValues: Readonly<Record<string, string | undefined>>,
): RuntimeEnvironmentEntries {
  const entries = Object.entries(environmentValues).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
  );

  return {
    allPresent: entries.map(([name]) => name),
    variableValues: new Map(entries),
  };
}

/**
 * Decide whether a missing conditionally-required key should be reported for the
 * given GitHub environment. Mirrors the `.refine()` clauses in `env-schema.ts` so
 * the validator only warns when the runtime would actually fail to boot — gating
 * by the controlling variable (e.g. `CAPTCHA_PROVIDER`, `METRICS_ENABLED`) or by
 * the environment (e.g. `CAPTCHA_SECRET` is always required in `production`).
 */
export function shouldReportMissingConditional(
  entry: { readonly key: string },
  environment: string,
  variableValues: ReadonlyMap<string, string>,
): boolean {
  if (entry.key === 'CAPTCHA_SECRET') {
    if (environment === 'production') {
      return true;
    }
    // Required only when CAPTCHA_PROVIDER is explicitly `turnstile`.
    // Schema default is `disabled`; absence ⇒ disabled ⇒ no warning.
    return variableValues.get('CAPTCHA_PROVIDER') === 'turnstile';
  }
  if (entry.key === 'METRICS_SCRAPE_TOKEN') {
    const metricsEnabled = variableValues.get('METRICS_ENABLED');
    // METRICS_ENABLED schema default is true; warn unless explicitly disabled.
    return metricsEnabled !== 'false' && metricsEnabled !== '0';
  }
  return true;
}

function fetchGitHubResource(
  environment: string,
  resource: 'secrets' | 'variables',
  jqPath: string,
): string[] {
  try {
    // `--paginate` is required: the GitHub REST API caps each page at 30 entries, so
    // without pagination the validator silently misses anything past the first page.
    const output = execSync(
      `gh api --paginate repos/:owner/:repo/environments/${environment}/${resource} --jq '${jqPath}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 },
    );
    return output
      .trim()
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch (commandError) {
    const message = commandError instanceof Error ? commandError.message : String(commandError);
    throw new Error(
      `Failed to fetch GitHub environment ${resource} for "${environment}": ${message}`,
    );
  }
}

function getGitHubEnvironmentSecretNames(environment: string): string[] {
  return fetchGitHubResource(environment, 'secrets', '.secrets[].name');
}

function getGitHubEnvironmentVariableEntries(
  environment: string,
): { name: string; value: string }[] {
  // `gh api` returns full {name,value} objects for variables (unlike secrets).
  // Use compact JSON per line — null-byte / control-char delimiters break `child_process`.
  const raw = fetchGitHubResource(environment, 'variables', '.variables[] | {name, value} | @json');
  return raw.map((entry) => {
    const parsed = JSON.parse(entry) as { name?: string; value?: string };
    return { name: parsed.name ?? '', value: parsed.value ?? '' };
  });
}

/** Resolves CLI shorthand or branch aliases to the hosted environment name from setup.config.json. */
export function resolveGitHubEnvironment(config: string): string {
  const setupConfig = loadConfigIfExists();
  if (!setupConfig) {
    const fallback: Record<string, string> = {
      dev: 'development',
      development: 'development',
      prod: 'production',
      production: 'production',
    };
    return fallback[config] ?? config;
  }

  const byBranch: Record<string, string> = {};
  const byName: Record<string, string> = {};
  for (const environment of setupConfig.environments) {
    byBranch[environment.branch] = environment.name;
    byName[environment.name] = environment.name;
  }
  const shorthand: Record<string, string> = {
    prod: byName.production ?? 'production',
  };
  return byBranch[config] ?? byName[config] ?? shorthand[config] ?? config;
}

function validateGitHubEnvironmentProtectionDrift(environment: string): boolean {
  const results = validateGitHubEnvironmentsDrift({ environmentNames: [environment] });
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
  const config = process.env.CONFIG ?? 'development';
  const environment = resolveGitHubEnvironment(config);
  const skipGitHub = process.env.SKIP_GITHUB_ENV === '1' || process.env.SKIP_GITHUB_ENV === 'true';
  if (!(skipGitHub || validateGitHubEnvironmentProtectionDrift(environment))) {
    process.exit(1);
  }

  if (skipGitHub) {
    console.log('SKIP_GITHUB_ENV set — skipping GitHub environment protection drift check.');
    console.log('');
  }

  console.log(`Validating GitHub environment: ${environment}`);
  console.log('Required variables source: Zod env schema (src/shared/config/env-schema.ts)');
  console.log('');

  const requiredVariables = getRequiredVariables();
  console.log(`Required schema keys: ${requiredVariables.length}`);

  const validationSource = process.env.GITHUB_ENV_VALIDATION_SOURCE ?? 'github-api';
  let allPresent: string[];
  let variableValues: ReadonlyMap<string, string>;

  if (validationSource === 'runtime') {
    const runtimeEntries = getRuntimeEnvironmentEntries(process.env);
    allPresent = runtimeEntries.allPresent;
    variableValues = runtimeEntries.variableValues;

    console.log('Validation source: runtime environment');
    console.log(`Runtime entries:   ${allPresent.length}`);
  } else {
    let secretNames: string[];
    let variableEntries: { name: string; value: string }[];
    try {
      secretNames = getGitHubEnvironmentSecretNames(environment);
      variableEntries = getGitHubEnvironmentVariableEntries(environment);
    } catch (fetchError) {
      console.error(fetchError instanceof Error ? fetchError.message : String(fetchError));
      process.exit(1);
    }

    const variableNames = variableEntries.map((entry) => entry.name);
    allPresent = [...secretNames, ...variableNames];
    variableValues = new Map(variableEntries.map((entry) => [entry.name, entry.value]));

    console.log('Validation source: GitHub API');
    console.log(`GitHub secrets:   ${secretNames.length}`);
    console.log(`GitHub variables: ${variableNames.length}`);
    console.log(`Total present:    ${allPresent.length}`);
  }
  console.log('');

  const missingVariables = requiredVariables.filter((variable) => !allPresent.includes(variable));
  const deploymentCountIssue = validateDeploymentProcessCountSecrets(environment, allPresent);

  const missingConditional = envSchemaConditionallyRequiredKeys.filter((entry) => {
    if (allPresent.includes(entry.key)) return false;
    return shouldReportMissingConditional(entry, environment, variableValues);
  });

  if (
    missingVariables.length === 0 &&
    deploymentCountIssue === undefined &&
    missingConditional.length === 0
  ) {
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
          'without its counterpart. Set both DEPLOYMENT_API_REPLICA_COUNT and DEPLOYMENT_WORKER_REPLICA_COUNT, ' +
          'or use the DEPLOYMENT_TOTAL_REPLICA_COUNT shorthand instead.',
      );
    } else {
      console.error(
        `GitHub environment "${environment}" is missing the Postgres connection-budget secret(s). ` +
          'Set DEPLOYMENT_TOTAL_REPLICA_COUNT (api_replicas + worker_replicas) or both ' +
          'DEPLOYMENT_API_REPLICA_COUNT and DEPLOYMENT_WORKER_REPLICA_COUNT so reusable-railway-deploy.yml ' +
          'forwards them and assertPostgresConnectionBudget() can validate sizing at startup.',
      );
    }
    console.log('');
    console.log('See docs/deployment/runbooks/resource-limits.md');
    console.log('');
  }

  if (missingConditional.length > 0) {
    console.warn(
      `${missingConditional.length} conditionally-required secret(s) missing from GitHub environment "${environment}":`,
    );
    console.log('');
    for (const entry of missingConditional) {
      console.warn(`  ${entry.key}  (required when ${entry.condition})`);
    }
    console.log('');
  }

  console.log(
    'To fix, add secrets or variables in GitHub: Settings → Environments →',
    environment,
    '→ Environment secrets / Environment variables',
  );
  console.log(
    'See docs/reference/architecture/env-naming-conventions.md for the secret-vs-variable classification.',
  );
  console.log('');

  // Hard fail only on missing strictly-required schema keys or deployment count issues.
  // Conditional keys are warnings since their requirement depends on flags whose values
  // GitHub does not expose (gh API returns secret *names* only).
  if (missingVariables.length > 0 || deploymentCountIssue !== undefined) {
    process.exit(1);
  }
  process.exit(0);
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main();
}
