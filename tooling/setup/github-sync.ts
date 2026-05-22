/**
 * Full GitHub sync — single entry point for local IaC + remote state + env values.
 *
 * Order:
 *   1. Consistency check (NODE_ENV ↔ config ↔ rulesets ↔ workflow ↔ GitHub env JSON).
 *   2. Scaffold missing local files from .github/sync.config.json (sync mode only).
 *   3. Remote init (branches → rulesets → GitHub Environment shells).
 *   4. Push .env.<environment> secrets and variables (sync mode only; confirms first).
 *
 * Modes:
 *   default    — scaffold + remote apply + values push (with confirmation).
 *   --check    — consistency + read-only remote drift; no writes.
 *   --dry-run  — consistency + preview remote and values; no writes.
 *   --yes      — skip values confirmation (automation).
 *
 * Usage:
 *   pnpm github:sync
 *   pnpm github:sync production
 *   pnpm github:sync --check
 *   pnpm github:sync --dry-run
 *   pnpm github:sync --yes
 *
 * Adding or removing a hosted environment: edit .github/sync.config.json, NODE_ENV,
 * deploy-railway.yml, and related IaC by hand — then run github:sync. There is no
 * env:add / env:remove / branch:add script.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { runGithubInit } from './github-init.js';
import {
  loadGithubSyncConfig,
  printGithubSyncConsistencyReport,
  scaffoldGithubSyncFiles,
  validateGithubSyncConsistency,
  type GitHubSyncConfig,
  type GitHubSyncScaffoldResult,
} from './github-sync-config.js';
import { syncEnvironmentToGitHub } from './sync-environment-to-github.js';
import type { SyncMode } from './sync-rulesets.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../');

interface CliOptions {
  readonly checkOnly: boolean;
  readonly dryRun: boolean;
  readonly skipConfirmation: boolean;
  readonly environments: string[];
}

function parseArguments(): CliOptions {
  const argumentsList = process.argv.slice(2);
  const environments: string[] = [];

  if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
    console.log('Usage: pnpm github:sync [environment...] [--check | --dry-run] [--yes]');
    console.log('');
    console.log('  (default)   Consistency + scaffold + branches/rulesets/environments + push values');
    console.log('  environment Optional environment name(s), e.g. production');
    console.log('  --check     Read-only consistency + remote drift (no writes)');
    console.log('  --dry-run   Preview remote and values push (no writes)');
    console.log('  --yes       Skip the values-push confirmation prompt');
    process.exit(0);
  }

  const allowed = new Set(['--check', '--dry-run', '--yes', '-y']);
  for (const argument of argumentsList) {
    if (allowed.has(argument)) continue;
    if (argument.startsWith('--')) {
      throw new Error(`Unknown argument "${argument}". Use --help for options.`);
    }
    if (!/^[a-z][a-z0-9-]*$/.test(argument)) {
      throw new Error(`Invalid environment "${argument}". Use lowercase letters, digits, dashes.`);
    }
    environments.push(argument);
  }

  if (argumentsList.includes('--check') && argumentsList.includes('--dry-run')) {
    throw new Error('Use either --check or --dry-run, not both.');
  }

  return {
    checkOnly: argumentsList.includes('--check'),
    dryRun: argumentsList.includes('--dry-run'),
    skipConfirmation: argumentsList.includes('--yes') || argumentsList.includes('-y'),
    environments,
  };
}

function detectLocalEnvironmentFiles(
  requestedEnvironments: readonly string[],
  config: GitHubSyncConfig,
): Array<{ environment: string; filePath: string }> {
  const environmentNames =
    requestedEnvironments.length > 0
      ? requestedEnvironments
      : config.environments.map((environment) => environment.name);
  const validEnvironmentNames = new Set(config.environments.map((environment) => environment.name));
  const found: Array<{ environment: string; filePath: string }> = [];
  for (const environment of environmentNames) {
    if (!validEnvironmentNames.has(environment)) {
      throw new Error(
        `${environment} is not listed in .github/sync.config.json. Edit the config file first.`,
      );
    }
    const filePath = resolve(PROJECT_ROOT, `.env.${environment}`);
    if (existsSync(filePath)) {
      found.push({ environment, filePath });
    } else if (requestedEnvironments.length > 0) {
      throw new Error(
        `Missing .env.${environment} at the repo root. Run \`pnpm github:sync\` without --dry-run to scaffold it.`,
      );
    }
  }
  return found;
}

function printScaffoldResult(scaffoldResult: GitHubSyncScaffoldResult): void {
  const created = [
    ...scaffoldResult.createdEnvironmentFiles,
    ...scaffoldResult.createdGithubEnvironmentConfigs,
    ...scaffoldResult.createdRulesets,
  ];
  if (created.length === 0) {
    console.log('Local GitHub sync files: already present.');
    console.log('');
    return;
  }
  console.log('Local GitHub sync files scaffolded:');
  for (const filePath of created) {
    console.log(`  + ${filePath}`);
  }
  console.log('');
}

async function askExactPhrase(question: string, expected: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(question);
    return answer.trim() === expected;
  } finally {
    readline.close();
  }
}

function isInteractiveShell(): boolean {
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function main(): Promise<void> {
  const { checkOnly, dryRun, skipConfirmation, environments } = parseArguments();
  const mode: SyncMode = checkOnly ? 'check' : dryRun ? 'dry-run' : 'sync';
  const config = loadGithubSyncConfig();

  console.log('GitHub sync config: .github/sync.config.json');
  console.log(
    `Configured environments: ${config.environments
      .map((environment) => `${environment.name}:${environment.branch}`)
      .join(', ')}`,
  );
  console.log('');

  printGithubSyncConsistencyReport(config);
  const consistencyIssues = validateGithubSyncConsistency(config);
  if (consistencyIssues.length > 0) {
    console.error('Environment consistency check failed:');
    for (const issue of consistencyIssues) {
      console.error(`  [${issue.dimension}] ${issue.detail}`);
    }
    console.error('');
    console.error('Fix .github/sync.config.json and related IaC, then re-run github:sync.');
    process.exit(1);
  }
  console.log('Environment consistency: OK');
  console.log('');

  const scaffoldResult =
    checkOnly || dryRun
      ? { createdEnvironmentFiles: [], createdGithubEnvironmentConfigs: [], createdRulesets: [] }
      : scaffoldGithubSyncFiles(config);
  printScaffoldResult(scaffoldResult);

  const initResult = await runGithubInit({
    mode,
    purpose: checkOnly
      ? 'Read-only check: branches + rulesets + environments'
      : 'GitHub sync: branches + rulesets + environments + values',
    scaffoldOnSync: false,
  });

  console.log('');

  if (initResult.failures > 0) {
    console.error(`Remote sync failed with ${initResult.failures} failure(s).`);
    process.exit(1);
  }

  if (checkOnly) {
    if (initResult.drift === 0) {
      console.log('Check complete — consistency OK and no remote drift.');
    } else {
      console.error(`Drift detected: ${initResult.drift} item(s) missing on remote.`);
      console.error('Run `pnpm github:sync` to apply.');
      process.exit(1);
    }
    process.exit(0);
  }

  const localFiles = detectLocalEnvironmentFiles(environments, config);
  if (localFiles.length === 0) {
    console.log('No local .env.<environment> files found.');
    console.log('Edit .github/sync.config.json if needed, then run `pnpm github:sync` again.');
    process.exit(0);
  }

  console.log('Pushing variables and secrets');
  for (const entry of localFiles) {
    console.log(`  .env.${entry.environment}  → GitHub Environment "${entry.environment}"`);
  }
  console.log('');

  if (!dryRun) {
    if (skipConfirmation) {
      console.log('  --yes supplied — skipping confirmation prompt.');
      console.log('');
    } else if (!isInteractiveShell()) {
      console.error('Non-interactive shell: re-run with --yes to push values.');
      process.exit(1);
    } else {
      console.log('  ! This OVERWRITES existing remote values for the environments above.');
      console.log('  ! Type "sync" to proceed (anything else aborts).');
      console.log('');
      const confirmed = await askExactPhrase('  Confirm: ', 'sync');
      if (!confirmed) {
        console.log('Aborted — no values were pushed.');
        process.exit(130);
      }
      console.log('');
    }
  }

  process.env.GITHUB_SYNC_PARENT = '1';

  let valueFailures = 0;
  for (const entry of localFiles) {
    console.log(`--- ${entry.environment} ---`);
    try {
      await syncEnvironmentToGitHub({
        environment: entry.environment,
        dryRun,
        skipPreflight: true,
      });
    } catch (error) {
      valueFailures += 1;
      console.error(`Push for "${entry.environment}" failed.`);
      console.error(error instanceof Error ? error.message : String(error));
    }
    console.log('');
  }

  if (valueFailures > 0) {
    console.error(`Sync finished with ${valueFailures} environment(s) failed.`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('Dry run complete. No changes pushed.');
    process.exit(0);
  }

  console.log('Sync complete.');
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
