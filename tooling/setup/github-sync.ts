/**
 * Full GitHub state sync.
 *
 * Wraps `pnpm github:init` (branches + rulesets + environments) and then pushes
 * per-environment secrets and variables from each gitignored `.env.<environment>`
 * file to the matching GitHub Environment.
 *
 * The values push is **non-reversible** — it overwrites whatever is on GitHub
 * with the local file contents. The operator must explicitly confirm before
 * any environment is touched.
 *
 * Order:
 *   1. github:init pipeline (auth preflight → branches → rulesets → environments).
 *   2. Detect which `.env.<environment>` files exist locally.
 *   3. CONFIRMATION PROMPT — list every environment that will receive values.
 *      Operator types the literal word `sync` to proceed (or `--yes` skips).
 *   4. For each environment, delegate to `sync-environment-to-github.ts`
 *      (which encrypts secrets, diffs variables, and pushes via the REST API).
 *
 * Modes:
 *   default      — run all steps; prompt before pushing values.
 *   --dry-run    — run init in dry-run; preview the values diff per env; no writes.
 *   --yes        — skip the values confirmation prompt (CI / automation).
 *
 * Usage:
 *   pnpm github:sync
 *   pnpm github:sync --dry-run
 *   pnpm github:sync --yes
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { runGithubInit } from './github-init.js';
import type { SyncMode } from './sync-rulesets.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../');
const ENV_SYNC_SCRIPT = resolve(PROJECT_ROOT, 'tooling/setup/sync-environment-to-github.ts');

interface CliOptions {
  readonly dryRun: boolean;
  readonly skipConfirmation: boolean;
}

function parseArguments(): CliOptions {
  const argumentsList = process.argv.slice(2);

  if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
    console.log('Usage: pnpm github:sync [--dry-run] [--yes]');
    console.log('');
    console.log('  (default)   Init + push every local .env.<env> to its GitHub Environment');
    console.log('  --dry-run   Preview only — no writes to branches, rulesets, or env values');
    console.log('  --yes       Skip the values-push confirmation prompt (non-reversible)');
    process.exit(0);
  }

  const allowed = new Set(['--dry-run', '--yes', '-y']);
  for (const argument of argumentsList) {
    if (!allowed.has(argument)) {
      throw new Error(`Unknown argument "${argument}". Use --help for options.`);
    }
  }

  return {
    dryRun: argumentsList.includes('--dry-run'),
    skipConfirmation: argumentsList.includes('--yes') || argumentsList.includes('-y'),
  };
}

function detectLocalEnvironmentFiles(): Array<{ environment: string; filePath: string }> {
  const candidates = ['development', 'production'];
  const found: Array<{ environment: string; filePath: string }> = [];
  for (const environment of candidates) {
    const filePath = resolve(PROJECT_ROOT, `.env.${environment}`);
    if (existsSync(filePath)) {
      found.push({ environment, filePath });
    }
  }
  return found;
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

function runEnvironmentSync(args: {
  readonly environment: string;
  readonly dryRun: boolean;
}): boolean {
  const subprocessArgs = ['tsx', ENV_SYNC_SCRIPT, args.environment];
  if (args.dryRun) {
    subprocessArgs.push('--dry-run');
  }
  const result = spawnSync('pnpm', ['exec', ...subprocessArgs], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: { ...process.env, GITHUB_SYNC_PARENT: '1' },
  });
  return result.status === 0;
}

async function main(): Promise<void> {
  const { dryRun, skipConfirmation } = parseArguments();
  const mode: SyncMode = dryRun ? 'dry-run' : 'sync';

  const initResult = await runGithubInit({
    mode,
    purpose: 'Full sync: branches + rulesets + environments + values',
  });

  console.log('');

  if (initResult.failures > 0) {
    console.error(`Init phase failed with ${initResult.failures} failure(s); aborting values push.`);
    process.exit(1);
  }

  const localFiles = detectLocalEnvironmentFiles();
  if (localFiles.length === 0) {
    console.log('No local .env.<environment> files found.');
    console.log(
      'Run `pnpm env:init` to scaffold them, fill values, then re-run `pnpm github:sync`.',
    );
    process.exit(0);
  }

  console.log('Step 4/4 — Pushing variables and secrets per environment');
  console.log('  Local files detected:');
  for (const entry of localFiles) {
    console.log(`    .env.${entry.environment}  → GitHub Environment "${entry.environment}"`);
  }
  console.log('');

  if (!dryRun) {
    if (skipConfirmation) {
      console.log('  --yes supplied — skipping confirmation prompt.');
      console.log('');
    } else {
      if (!isInteractiveShell()) {
        console.error(
          'Non-interactive shell and --yes was not supplied; refusing to push values.',
        );
        console.error('Re-run with --yes to confirm, or in an interactive terminal.');
        process.exit(1);
      }

      console.log('  ! This OVERWRITES existing remote values for the environments above.');
      console.log('  ! Secrets are encrypted before push; variables are written in plaintext.');
      console.log('  ! There is no undo — old remote values cannot be recovered.');
      console.log('');
      const confirmed = await askExactPhrase(
        '  Type the word "sync" to proceed (anything else aborts): ',
        'sync',
      );
      if (!confirmed) {
        console.log('Aborted — no values were pushed.');
        process.exit(130);
      }
      console.log('');
    }
  }

  let valueFailures = 0;
  for (const entry of localFiles) {
    console.log(`--- ${entry.environment} ---`);
    const succeeded = runEnvironmentSync({ environment: entry.environment, dryRun });
    if (!succeeded) {
      valueFailures += 1;
      console.error(`Push for "${entry.environment}" failed.`);
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

  console.log('Sync complete: branches, rulesets, environments, and values all up to date.');
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
