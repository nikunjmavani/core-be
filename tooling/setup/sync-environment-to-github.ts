/**
 * Sync a local `.env.<environment>` file to its matching GitHub Environment.
 *
 * Classification is read straight from the file's structure — anything under
 * the "GitHub Secrets" half becomes a `gh secret`, anything under the "GitHub
 * Variables" half becomes a `gh variable`. There is no separate classifier;
 * the file IS the source of truth.
 *
 * Workflow:
 *   1. Operator runs `pnpm env:init` once → creates `.env.development` and
 *      `.env.production` from `.env.example` (both gitignored).
 *   2. Operator edits `.env.<environment>` with real values.
 *   3. Operator runs `pnpm env:sync <environment>` → this script:
 *        - Creates the GitHub Environment (idempotent).
 *        - Encrypts secrets locally with GitHub's environment public key and pushes
 *          them through the REST API.
 *        - Fetches existing variables once, skips unchanged values, and creates or
 *          updates only the diff through the REST API.
 *
 * Empty values are skipped, so operators can leave optional integrations
 * (Stripe, OAuth, S3) blank without pushing meaningless empty strings.
 *
 * Usage:
 *   pnpm env:sync development
 *   pnpm env:sync production --dry-run     # show what would be pushed
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sodium from 'libsodium-wrappers';

import { parseEnvExampleSections, type EnvExampleKey } from './parse-env-example-sections.js';
import { runGhAuthPreflight } from './gh-auth-preflight.js';

const projectRoot = process.cwd();

const RATE_LIMIT_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 240_000] as const;

interface GitHubEnvironmentPublicKey {
  readonly key_id: string;
  readonly key: string;
}

interface GitHubEnvironmentVariablesResponse {
  readonly variables: ReadonlyArray<{
    readonly name: string;
    readonly value: string;
  }>;
}

class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function getGitHubToken(): string {
  return execSync('gh auth token', { encoding: 'utf-8' }).trim();
}

function getRepositoryFullName(): string {
  return execSync('gh api repos/:owner/:repo --jq .full_name', {
    encoding: 'utf-8',
  }).trim();
}

function buildGitHubApiUrl(pathname: string): string {
  return `https://api.github.com/${pathname.replace(/^\/+/, '')}`;
}

async function requestGitHub<T>(
  token: string,
  label: string,
  pathname: string,
  options: { readonly method?: string; readonly body?: unknown } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(buildGitHubApiUrl(pathname), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }
    const responseText = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= RATE_LIMIT_BACKOFF_MS.length) {
      throw new GitHubApiError(response.status, `${label}: HTTP ${response.status} ${responseText}`);
    }
    const waitMs = RATE_LIMIT_BACKOFF_MS[attempt];
    console.warn(
      `  ! GitHub API throttled "${label}" — backing off ${formatDuration(waitMs)} ` +
        `(retry ${attempt + 1}/${RATE_LIMIT_BACKOFF_MS.length})`,
    );
    await sleep(waitMs);
  }
}

interface ParsedArguments {
  readonly environment: string;
  readonly dryRun: boolean;
  readonly skipCreate: boolean;
}

function parseArguments(argv: string[]): ParsedArguments {
  let environment: string | undefined;
  let dryRun = false;
  let skipCreate = false;
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
      continue;
    }
    if (arg === '--no-create') {
      skipCreate = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: pnpm env:sync <environment> [--dry-run] [--no-create]');
      console.log('');
      console.log('  <environment>  Name of the .env.<environment> file (and GitHub Env)');
      console.log('  --dry-run      Print the plan without calling gh');
      console.log('  --no-create    Skip creating the GitHub Environment (must already exist)');
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
    if (environment !== undefined) {
      console.error('Specify exactly one environment.');
      process.exit(2);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(arg)) {
      console.error(`Invalid environment name "${arg}". Use lowercase letters, digits, dashes.`);
      process.exit(2);
    }
    environment = arg;
  }
  if (environment === undefined) {
    console.error('Missing required argument: <environment>');
    console.error('Usage: pnpm env:sync <environment> [--dry-run] [--no-create]');
    process.exit(2);
  }
  return { environment, dryRun, skipCreate };
}

function flatten(section: { subSections: { keys: EnvExampleKey[] }[] }): EnvExampleKey[] {
  return section.subSections.flatMap((s) => s.keys).filter((k) => k.value !== '');
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  const totalSeconds = Math.round(milliseconds / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

function padIndex(index: number, total: number): string {
  return String(index).padStart(String(total).length, ' ');
}

async function createGitHubEnvironment(
  token: string,
  repositoryFullName: string,
  environment: string,
): Promise<void> {
  await requestGitHub<void>(
    token,
    `create env ${environment}`,
    `repos/${repositoryFullName}/environments/${encodeURIComponent(environment)}`,
    { method: 'PUT' },
  );
}

async function getEnvironmentPublicKey(
  token: string,
  repositoryFullName: string,
  environment: string,
): Promise<GitHubEnvironmentPublicKey> {
  return requestGitHub<GitHubEnvironmentPublicKey>(
    token,
    `fetch public key for ${environment}`,
    `repos/${repositoryFullName}/environments/${encodeURIComponent(environment)}/secrets/public-key`,
  );
}

async function fetchExistingVariables(
  token: string,
  repositoryFullName: string,
  environment: string,
): Promise<Map<string, string>> {
  const response = await requestGitHub<GitHubEnvironmentVariablesResponse>(
    token,
    `fetch variables for ${environment}`,
    `repos/${repositoryFullName}/environments/${encodeURIComponent(environment)}/variables?per_page=100`,
  );
  return new Map(response.variables.map((entry) => [entry.name, entry.value]));
}

async function setSecret(
  token: string,
  repositoryFullName: string,
  environment: string,
  publicKey: GitHubEnvironmentPublicKey,
  name: string,
  value: string,
): Promise<void> {
  await sodium.ready;
  const encryptedValue = sodium.to_base64(
    sodium.crypto_box_seal(
      sodium.from_string(value),
      sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL),
    ),
    sodium.base64_variants.ORIGINAL,
  );
  await requestGitHub<void>(
    token,
    `set secret ${name}`,
    `repos/${repositoryFullName}/environments/${encodeURIComponent(environment)}/secrets/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      body: {
        encrypted_value: encryptedValue,
        key_id: publicKey.key_id,
      },
    },
  );
}

async function setVariable(
  token: string,
  repositoryFullName: string,
  environment: string,
  existingVariables: Map<string, string>,
  name: string,
  value: string,
): Promise<'created' | 'updated' | 'skipped'> {
  const existingValue = existingVariables.get(name);
  if (existingValue === value) return 'skipped';

  if (existingValue === undefined) {
    try {
      await requestGitHub<void>(
        token,
        `create variable ${name}`,
        `repos/${repositoryFullName}/environments/${encodeURIComponent(environment)}/variables`,
        {
          method: 'POST',
          body: { name, value },
        },
      );
      return 'created';
    } catch (error) {
      if (!(error instanceof GitHubApiError) || error.status !== 409) {
        throw error;
      }
    }
  }

  await requestGitHub<void>(
    token,
    `update variable ${name}`,
    `repos/${repositoryFullName}/environments/${encodeURIComponent(environment)}/variables/${encodeURIComponent(name)}`,
    {
      method: 'PATCH',
      body: { name, value },
    },
  );
  return 'updated';
}

async function main(): Promise<void> {
  const { environment, dryRun, skipCreate } = parseArguments(process.argv.slice(2));
  const envFilePath = resolve(projectRoot, `.env.${environment}`);

  if (!existsSync(envFilePath)) {
    console.error(`Missing .env.${environment} at the repo root.`);
    console.error(`Run \`pnpm env:init ${environment}\` to scaffold it from .env.example.`);
    process.exit(1);
  }

  const parsed = parseEnvExampleSections(envFilePath);
  const secrets = flatten(parsed.secrets);
  const variables = flatten(parsed.variables);

  console.log(`Source:      .env.${environment}`);
  console.log(`Environment: ${environment}`);
  console.log(`Plan:        ${secrets.length} secret(s), ${variables.length} variable(s)`);
  console.log('');

  if (dryRun) {
    for (const entry of secrets) console.log(`  [secret]   ${entry.name}`);
    for (const entry of variables) console.log(`  [variable] ${entry.name}`);
    console.log('');
    console.log('Dry run — no API calls made. Drop --dry-run to push.');
    return;
  }

  const repositoryFullName = getRepositoryFullName();

  // Skip the preflight when invoked from `github:sync` — that caller already
  // verified the active user once and chained env-sync runs should not
  // re-prompt for every environment.
  if (process.env.GITHUB_SYNC_PARENT !== '1') {
    await runGhAuthPreflight({
      repository: repositoryFullName,
      purpose: `Push secrets and variables to GitHub Environment "${environment}"`,
      destructive: true,
    });
  }

  const token = getGitHubToken();
  if (!skipCreate) {
    console.log(`Creating GitHub environment "${environment}" (idempotent)...`);
    await createGitHubEnvironment(token, repositoryFullName, environment);
  }
  const publicKey = await getEnvironmentPublicKey(token, repositoryFullName, environment);
  const existingVariables = await fetchExistingVariables(token, repositoryFullName, environment);

  const totalItems = secrets.length + variables.length;
  console.log(`Pushing ${totalItems} item(s) through the GitHub REST API`);
  console.log('(Variables with unchanged values are skipped; secrets are always re-encrypted and pushed).');
  console.log('');

  const startTime = Date.now();
  let processed = 0;
  const push = async (
    kind: 'secret' | 'variable',
    name: string,
    action: () => Promise<'created' | 'updated' | 'skipped' | 'pushed'>,
  ): Promise<void> => {
    const itemStart = Date.now();
    const status = await action();
    const itemDuration = Date.now() - itemStart;

    processed += 1;
    const remaining = totalItems - processed;
    const elapsed = Date.now() - startTime;
    const averagePerItem = elapsed / processed;
    const estimatedRemaining = Math.round(averagePerItem * remaining);
    const indexLabel = `${padIndex(processed, totalItems)}/${totalItems}`;
    const kindLabel = kind === 'secret' ? '[secret]  ' : '[variable]';

    console.log(
      `  ${indexLabel}  ${kindLabel} ${name}  (${status}, took ${formatDuration(itemDuration)}, ${remaining} left, ETA ${formatDuration(estimatedRemaining)})`,
    );
  };

  for (const entry of secrets) {
    await push('secret', entry.name, async () => {
      await setSecret(token, repositoryFullName, environment, publicKey, entry.name, entry.value);
      return 'pushed';
    });
  }
  for (const entry of variables) {
    await push('variable', entry.name, async () => {
      return setVariable(
        token,
        repositoryFullName,
        environment,
        existingVariables,
        entry.name,
        entry.value,
      );
    });
  }

  const totalDuration = Date.now() - startTime;
  console.log('');
  console.log(`Done. Pushed ${totalItems} item(s) in ${formatDuration(totalDuration)}.`);
  console.log(`Verify: SKIP_GITHUB_ENV=1 CONFIG=${environment} pnpm validate:github-env`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
