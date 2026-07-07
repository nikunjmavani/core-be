/**
 * One-step GitHub bootstrap.
 *
 * Runs — in order — to bring a fresh repository (or fresh deploy target) up to
 * the committed source-of-truth state. Idempotent: safe to re-run.
 *
 *   1. gh auth preflight (show active user, allow switch).
 *   2. Sync rulesets (POST new ones, PUT existing by name).
 *   3. Ensure each GitHub Environment from .github/environments/*.json exists
 *      (idempotent PUT with no protection updates — protection drift is
 *      surfaced separately by `pnpm validate:github-environments`).
 *
 * Single trunk: `main` is the only long-lived branch and it is the repository
 * default — always present — so there is no branch-creation step. Hotfixes
 * fix-forward to `main` via ordinary `fix/*` branches; there are no protected
 * release branches.
 *
 * Does NOT push variables or secrets. Use `pnpm github:sync` for that.
 *
 * Usage:
 *   Invoked by `pnpm github:sync` (and `github:sync --check` / `--dry-run`).
 *   Do not run this file directly — use `pnpm github:sync`.
 *
 * Modes:
 *   default      — write changes to the remote.
 *   --check      — read-only drift report; exit non-zero if anything is missing.
 *   --dry-run    — show what would be created or updated without writing.
 *
 * Plan note: repository rulesets require GitHub Pro / Team / Enterprise on
 * private repos. Environment creation works on every plan. So on the free
 * personal plan this script creates environments, then fails at the rulesets
 * step with the upstream "Upgrade to GitHub Pro …" message.
 */

import { execSync } from 'node:child_process';

import { loadConfig } from '@tooling/setup/common/config.js';
import { runGhAuthPreflight } from './auth-preflight.js';
import { getGithubSyncEnvironmentNames, scaffoldGithubSyncFiles } from './sync-config.js';
import {
  getRepositoryIdentifier,
  loadLocalRulesets,
  syncRulesets,
  type SyncMode,
} from './rulesets.js';

interface GhProbeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function ghProbe(args: readonly string[]): GhProbeResult {
  try {
    const stdout = execSync(`gh ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (commandError) {
    const errorObject = commandError as {
      status?: number;
      stderr?: Buffer | string;
      stdout?: Buffer | string;
    };
    const stderr =
      typeof errorObject.stderr === 'string'
        ? errorObject.stderr
        : (errorObject.stderr?.toString('utf-8') ?? '');
    const stdout =
      typeof errorObject.stdout === 'string'
        ? errorObject.stdout
        : (errorObject.stdout?.toString('utf-8') ?? '');
    return { exitCode: errorObject.status ?? 1, stdout, stderr };
  }
}

function ghWriteWithBody(args: readonly string[], body: string): void {
  try {
    execSync(`gh ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      input: body,
    });
  } catch (commandError) {
    const errorObject = commandError as {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
      message?: string;
    };
    const stderr =
      typeof errorObject.stderr === 'string'
        ? errorObject.stderr
        : (errorObject.stderr?.toString('utf-8') ?? '');
    const stdout =
      typeof errorObject.stdout === 'string'
        ? errorObject.stdout
        : (errorObject.stdout?.toString('utf-8') ?? '');
    throw new Error(stderr || stdout || (errorObject.message ?? 'gh command failed'));
  }
}

function environmentExists(repository: string, environment: string): boolean {
  const probe = ghProbe(['api', `repos/${repository}/environments/${environment}`]);
  if (probe.exitCode === 0) return true;
  if (/HTTP\s+404/i.test(probe.stderr) || /HTTP\s+404/i.test(probe.stdout)) return false;
  throw new Error(
    `Failed to probe environment "${environment}" on ${repository}: ${probe.stderr || probe.stdout || `exit ${probe.exitCode}`}`,
  );
}

function createOrUpdateEnvironment(repository: string, environment: string): void {
  ghWriteWithBody(
    [
      'api',
      '--method',
      'PUT',
      '-H',
      "'Accept: application/vnd.github+json'",
      `repos/${repository}/environments/${environment}`,
      '--input',
      '-',
    ],
    '{}',
  );
}

interface EnsureResult {
  readonly failures: number;
  readonly drift: number;
}

function ensureEnvironments(args: {
  readonly repository: string;
  readonly environments: readonly string[];
  readonly mode: SyncMode;
}): EnsureResult {
  const { repository, environments, mode } = args;

  if (environments.length === 0) {
    console.log('  (no .github/environments/*.json files found)');
    return { failures: 0, drift: 0 };
  }

  let failures = 0;
  let drift = 0;

  for (const environment of environments) {
    try {
      const exists = environmentExists(repository, environment);

      if (exists) {
        console.log(`  ${environment}: already present`);
        continue;
      }

      if (mode === 'check') {
        console.error(`  ${environment}: missing on remote`);
        drift += 1;
        continue;
      }

      if (mode === 'dry-run') {
        console.log(`  ${environment}: would create`);
        continue;
      }

      createOrUpdateEnvironment(repository, environment);
      console.log(`  ${environment}: created`);
    } catch (ensureError) {
      failures += 1;
      const message = ensureError instanceof Error ? ensureError.message : String(ensureError);
      console.error(`  ${environment}: FAILED`);
      console.error(`    ${message.replace(/\n/g, '\n    ')}`);
    }
  }

  return { failures, drift };
}

export interface RunGithubInitResult {
  readonly failures: number;
  readonly drift: number;
}

/**
 * Run the init pipeline. Exported so `tooling/setup/github/sync.ts` can compose
 * it without spawning a subprocess.
 */
export async function runGithubInit(args: {
  readonly mode: SyncMode;
  readonly purpose?: string;
  /** Skip gh auth preflight (e.g. setup:infra with GITHUB_TOKEN only). */
  readonly skipPreflight?: boolean;
  /** When true, scaffold local IaC on sync mode (default). github/sync.ts passes false — it scaffolds first. */
  readonly scaffoldOnSync?: boolean;
  /**
   * Restrict the sync to these environment names (setup:infra runs this once per environment, so
   * each pass syncs only that environment's ruleset + GitHub Environment). Omit for the whole
   * repository (`pnpm github:sync`).
   */
  readonly environmentNames?: readonly string[];
}): Promise<RunGithubInitResult> {
  const config = loadConfig();
  const scaffoldOnSync = args.scaffoldOnSync ?? true;
  if (args.mode === 'sync' && scaffoldOnSync) {
    scaffoldGithubSyncFiles(config);
  }

  const repository = getRepositoryIdentifier();
  const allLocals = loadLocalRulesets();
  const allEnvironments = getGithubSyncEnvironmentNames(config);

  // Per-environment scope: narrow rulesets / GitHub Environments to the requested environment(s).
  // Each environment maps 1:1 to a committed ruleset file `<branch>.json` (via
  // `config.environments[].branch`), so filtering by env cleanly separates the work. Single trunk:
  // `main` is the only long-lived branch and it is the repository default (always present), so there
  // is no branch-creation step — only rulesets and GitHub Environments are reconciled here.
  const scopeEnvironments = args.environmentNames;
  const scopedBranches = new Set(
    (scopeEnvironments
      ? config.environments.filter((environment) => scopeEnvironments.includes(environment.name))
      : config.environments
    ).map((environment) => environment.branch),
  );
  const environments = scopeEnvironments
    ? allEnvironments.filter((environment) => scopeEnvironments.includes(environment))
    : allEnvironments;
  const locals = scopeEnvironments
    ? allLocals.filter((local) => scopedBranches.has(local.fileName.replace(/\.json$/, '')))
    : allLocals;

  console.log(`Repository:    ${repository}`);
  console.log(`Mode:          ${args.mode}`);
  console.log('Config:        tooling/setup/setup.config.json');
  console.log(`Rulesets:      ${locals.map((local) => local.fileName).join(', ')}`);
  console.log(`Environments:  ${environments.length > 0 ? environments.join(', ') : '(none)'}`);
  console.log('');

  if (!args.skipPreflight) {
    await runGhAuthPreflight({
      repository,
      purpose: args.purpose ?? 'Sync GitHub rulesets and environments',
      destructive: args.mode === 'sync',
    });
  }

  console.log('Step 1/2 — Syncing rulesets');
  const rulesetResult = syncRulesets({ repository, locals, mode: args.mode });

  console.log('');
  console.log('Step 2/2 — Ensuring GitHub Environments exist');
  const environmentResult = ensureEnvironments({ repository, environments, mode: args.mode });

  return {
    failures: rulesetResult.failures + environmentResult.failures,
    drift: rulesetResult.drift + environmentResult.drift,
  };
}
