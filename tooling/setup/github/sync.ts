/**
 * Full GitHub sync — single entry point for local IaC + remote state + env values.
 *
 * Order:
 *   1. Consistency check (NODE_ENV ↔ config ↔ rulesets ↔ workflow ↔ GitHub env JSON).
 *   2. Scaffold missing local files from tooling/setup/setup.config.json (sync mode only).
 *   3. Remote init (rulesets → GitHub Environment shells). Single trunk: `main` is
 *      the only long-lived branch and it is the repository default, so no branch
 *      is created here.
 *   4. Reconcile .env.<environment> → GitHub Environments (sync mode only):
 *        - Push all secrets and variables from each local file.
 *        - Delete any secret or variable on GitHub NOT in the local file.
 *
 * Modes:
 *   default    — all environments: scaffold + remote apply + full reconcile.
 *   <env>      — single environment reconcile.
 *   --check    — consistency + read-only remote drift; no writes.
 *   --dry-run  — consistency + preview remote and values; no writes.
 *   --diff     — read-only per-variable table (schema default vs local vs remote vs decision); no writes.
 *   --fill-gaps — append any schema key missing from .env.<env> as a blank line; writes local files only.
 *   --yes      — skip values confirmation (automation).
 *
 * A normal sync also fills those gaps automatically (via the scaffold step), so `--fill-gaps` is just
 * the standalone form for closing them without a full push.
 *
 * Usage:
 *   pnpm github:sync                  # reconcile ALL configured environments
 *   pnpm github:sync production       # reconcile a single environment
 *   pnpm github:sync --check
 *   pnpm github:sync --dry-run
 *   pnpm github:sync development --diff        # per-variable default/local/remote/decision table
 *   pnpm github:sync production --fill-gaps    # append missing keys as blank (no GitHub writes)
 *   pnpm github:sync --yes
 *
 * Adding or removing a hosted environment: edit tooling/setup/setup.config.json, NODE_ENV,
 * reusable-railway-deploy.yml, and related IaC by hand — then run setup:github. There is no
 * env:add / env:remove script.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '@tooling/setup/common/config.js';
import type { SetupConfig } from '@tooling/setup/common/types.js';
import { runGithubInit } from './init.js';
import {
  fillEnvFileGaps,
  printGithubSyncConsistencyReport,
  scaffoldGithubSyncFiles,
  validateGithubSyncConsistency,
  type GitHubSyncScaffoldResult,
} from './sync-config.js';
import {
  formatSyncPreviewTable,
  previewEnvironmentSync,
  syncEnvironmentToGitHub,
} from './sync-github-environments.js';
import type { SyncMode } from './rulesets.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../');

interface CliOptions {
  readonly checkOnly: boolean;
  readonly dryRun: boolean;
  readonly diff: boolean;
  readonly fillGaps: boolean;
  readonly skipConfirmation: boolean;
  readonly prune: boolean;
  readonly keepSchemaDefaults: boolean;
  readonly environments: string[];
}

function parseArguments(): CliOptions {
  const argumentsList = process.argv.slice(2);
  const environments: string[] = [];

  if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
    console.log(
      'Usage: pnpm github:sync [environment...] [--check | --dry-run] [--yes] [--prune] [--keep-schema-defaults]',
    );
    console.log('');
    console.log('  (default)   All environments: scaffold + remote apply + full reconcile');
    console.log('  environment Optional environment name(s), e.g. production');
    console.log('  --check     Read-only consistency + remote drift (no writes)');
    console.log('  --dry-run   Preview remote and values push (no writes)');
    console.log('  --diff      Read-only per-variable table: schema default vs local vs remote vs');
    console.log('              the decision the sync would make (no writes)');
    console.log(
      '  --fill-gaps Append any schema key missing from .env.<env> as a blank line, so no',
    );
    console.log('              variable is silently absent (writes local files only, no GitHub)');
    console.log('  --yes       Skip the values-push confirmation prompt');
    console.log('  --prune     Delete remote environments not in setup.config.json');
    console.log('  --keep-schema-defaults  Push variables equal to their env-schema default');
    console.log('                          instead of skipping and pruning them');
    process.exit(0);
  }

  const allowed = new Set([
    '--check',
    '--dry-run',
    '--diff',
    '--fill-gaps',
    '--yes',
    '-y',
    '--prune',
    '--keep-schema-defaults',
  ]);
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

  const exclusiveModes = ['--check', '--dry-run', '--diff', '--fill-gaps'].filter((flag) =>
    argumentsList.includes(flag),
  );
  if (exclusiveModes.length > 1) {
    throw new Error(
      `Use only one of --check / --dry-run / --diff / --fill-gaps (got ${exclusiveModes.join(', ')}).`,
    );
  }

  return {
    checkOnly: argumentsList.includes('--check'),
    dryRun: argumentsList.includes('--dry-run'),
    diff: argumentsList.includes('--diff'),
    fillGaps: argumentsList.includes('--fill-gaps'),
    skipConfirmation: argumentsList.includes('--yes') || argumentsList.includes('-y'),
    prune: argumentsList.includes('--prune'),
    keepSchemaDefaults: argumentsList.includes('--keep-schema-defaults'),
    environments,
  };
}

/**
 * Prune remote GitHub environments and rulesets that are not in the config.
 * Asks for confirmation before removing anything.
 */
async function pruneStaleEnvironments(config: SetupConfig): Promise<void> {
  const { execSync } = await import('node:child_process');
  const configEnvNames = new Set(config.environments.map((e) => e.name));

  // List remote environments
  let remoteEnvs: string[] = [];
  try {
    const output = execSync(
      `gh api repos/${config.providers.github.repository}/environments --jq '.environments[].name'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000 },
    );
    remoteEnvs = output.trim().split('\n').filter(Boolean);
  } catch {
    console.log('  Could not list remote environments — skipping prune.');
    return;
  }

  const staleEnvs = remoteEnvs.filter((e) => !configEnvNames.has(e));
  if (staleEnvs.length === 0) {
    console.log('No stale environments to prune.');
    return;
  }

  console.log('');
  console.log(`  Stale environments on remote (not in config): ${staleEnvs.join(', ')}`);
  console.log('  Rulesets for branches not in config will also be flagged.');
  console.log('');

  if (!isInteractiveShell()) {
    console.log('  Non-interactive shell — skipping prune. Re-run with --yes for automation.');
    return;
  }

  const { default: readlineModule } = await import('node:readline/promises');
  const rl = readlineModule.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`  Remove these environments? Type "prune" to confirm: `);
  rl.close();

  if (answer.trim() !== 'prune') {
    console.log('  Prune aborted.');
    return;
  }

  for (const env of staleEnvs) {
    try {
      execSync(
        `gh api --method DELETE repos/${config.providers.github.repository}/environments/${env}`,
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10_000,
        },
      );
      console.log(`  ✓ Removed environment: ${env}`);
    } catch (deleteError) {
      const msg = deleteError instanceof Error ? deleteError.message : String(deleteError);
      console.error(`  ✗ Failed to remove ${env}: ${msg}`);
    }
  }

  console.log('');
}

function detectLocalEnvironmentFiles(
  requestedEnvironments: readonly string[],
  config: SetupConfig,
): Array<{ environment: string; filePath: string }> {
  const environmentNames =
    requestedEnvironments.length > 0
      ? requestedEnvironments
      : config.environments.map((e) => e.name);
  const validEnvironmentNames = new Set(config.environments.map((e) => e.name));
  const found: Array<{ environment: string; filePath: string }> = [];
  for (const environment of environmentNames) {
    if (!validEnvironmentNames.has(environment)) {
      throw new Error(
        `${environment} is not listed in setup.config.json. Edit the config file first.`,
      );
    }
    const filePath = resolve(PROJECT_ROOT, `.env.${environment}`);
    if (existsSync(filePath)) {
      found.push({ environment, filePath });
    } else if (requestedEnvironments.length > 0) {
      throw new Error(
        `Missing .env.${environment} at the repo root. Run \`pnpm setup:envs\` to create it from .env.example.`,
      );
    } else {
      console.log(`  Skipping "${environment}" — no .env.${environment} file found.`);
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
  if (created.length > 0) {
    console.log('Local GitHub sync files scaffolded:');
    for (const filePath of created) {
      console.log(`  + ${filePath}`);
    }
    console.log('');
  }
  if (scaffoldResult.filledEnvironmentGaps.length > 0) {
    console.log(
      `Filled ${scaffoldResult.filledEnvironmentGaps.length} missing key(s) as blank (so no schema key stays silently absent):`,
    );
    for (const entry of scaffoldResult.filledEnvironmentGaps) {
      console.log(`  ~ ${entry}`);
    }
    console.log('');
  }
  if (created.length === 0 && scaffoldResult.filledEnvironmentGaps.length === 0) {
    console.log('Local GitHub sync files: already present.');
    console.log('');
  }
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
  const {
    checkOnly,
    dryRun,
    diff,
    fillGaps,
    skipConfirmation,
    prune,
    keepSchemaDefaults,
    environments,
  } = parseArguments();
  const mode: SyncMode = checkOnly ? 'check' : dryRun ? 'dry-run' : 'sync';
  const config = loadConfig();

  console.log('Sync config: tooling/setup/setup.config.json');
  console.log(`Configured environments: ${config.environments.map((e) => e.name).join(', ')}`);
  console.log('');

  printGithubSyncConsistencyReport(config);
  const consistencyIssues = validateGithubSyncConsistency(config);
  if (consistencyIssues.length > 0) {
    console.error('Environment consistency check failed:');
    for (const issue of consistencyIssues) {
      console.error(`  [${issue.dimension}] ${issue.detail}`);
    }
    console.error('');
    console.error('Fix tooling/setup/setup.config.json and related IaC, then re-run setup:github.');
    process.exit(1);
  }
  console.log('Environment consistency: OK');
  console.log('');

  // --diff is a read-only, per-variable preview: reads each local file, fetches the live GitHub
  // Environment (fully paginated), and prints the default/local/remote/decision table. No scaffold,
  // no rulesets, no writes — so it short-circuits before the remote-apply path below.
  if (diff) {
    const localFiles = detectLocalEnvironmentFiles(environments, config);
    if (localFiles.length === 0) {
      console.log('No local .env.<environment> files found to preview.');
      process.exit(0);
    }
    for (const entry of localFiles) {
      const rows = await previewEnvironmentSync({
        environment: entry.environment,
        keepSchemaDefaults,
      });
      console.log(formatSyncPreviewTable({ rows, environment: entry.environment }));
      console.log('');
    }
    process.exit(0);
  }

  // --fill-gaps closes gaps explicitly without a full sync: appends any schema key missing from each
  // target .env.<env> as a blank line. Writes local files only — no GitHub calls. (A normal sync also
  // does this automatically via the scaffold step, so this flag is just the standalone form.)
  if (fillGaps) {
    const localFiles = detectLocalEnvironmentFiles(environments, config);
    if (localFiles.length === 0) {
      console.log('No local .env.<environment> files found to fill.');
      process.exit(0);
    }
    let totalFilled = 0;
    for (const entry of localFiles) {
      const { filled } = fillEnvFileGaps({
        envFilePath: resolve(PROJECT_ROOT, `.env.${entry.environment}`),
      });
      totalFilled += filled.length;
      if (filled.length === 0) {
        console.log(`.env.${entry.environment}: already complete — no gaps.`);
      } else {
        console.log(`.env.${entry.environment}: filled ${filled.length} missing key(s) as blank:`);
        for (const key of filled) console.log(`  ~ ${key}`);
      }
    }
    console.log('');
    console.log(
      totalFilled === 0
        ? 'No gaps found. Every schema key is already declared in each environment file.'
        : `Filled ${totalFilled} gap(s). Review the appended blank lines and set values where an override is needed.`,
    );
    process.exit(0);
  }

  const scaffoldResult =
    checkOnly || dryRun
      ? {
          createdEnvironmentFiles: [],
          createdGithubEnvironmentConfigs: [],
          createdRulesets: [],
          filledEnvironmentGaps: [],
        }
      : scaffoldGithubSyncFiles(config);
  printScaffoldResult(scaffoldResult);

  const initResult = await runGithubInit({
    mode,
    purpose: checkOnly
      ? 'Read-only check: rulesets + environments'
      : 'GitHub sync: rulesets + environments + values',
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

  // Prune stale environments/rulesets not in config
  if (prune && !dryRun) {
    await pruneStaleEnvironments(config);
  }

  const localFiles = detectLocalEnvironmentFiles(environments, config);
  if (localFiles.length === 0) {
    console.log('No local .env.<environment> files found.');
    console.log(
      'Edit tooling/setup/setup.config.json if needed, then run `pnpm setup:github` again.',
    );
    process.exit(0);
  }

  console.log('Reconciling environments (push + delete stale)');
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
      console.log('  ! This reconciles GitHub Environments against local .env.<env> files.');
      console.log('  ! Items in the local files are pushed; items on GitHub NOT in the');
      console.log('  ! local files are DELETED. The local file is the source of truth.');
      if (!keepSchemaDefaults) {
        console.log('  ! Variables equal to their env-schema default are NOT pushed and are');
        console.log('  ! pruned from GitHub (runtime uses the default). --keep-schema-defaults');
        console.log('  ! pushes them verbatim.');
      }
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
  let totalPushed = 0;
  let totalUnchanged = 0;
  let totalEmptySkipped = 0;
  let totalDeleted = 0;
  let totalSchemaDefaultSkipped = 0;

  for (const entry of localFiles) {
    console.log(`--- ${entry.environment} ---`);
    try {
      const result = await syncEnvironmentToGitHub({
        environment: entry.environment,
        dryRun,
        skipPreflight: true,
        keepSchemaDefaults,
      });
      totalPushed += result.pushed;
      totalUnchanged += result.unchanged;
      totalEmptySkipped += result.emptySkipped;
      totalDeleted += result.deleted;
      totalSchemaDefaultSkipped += result.schemaDefaultSkipped;
    } catch (error) {
      valueFailures += 1;
      console.error(`Sync for "${entry.environment}" failed.`);
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

  console.log(
    `Sync complete — pushed ${totalPushed}, unchanged ${totalUnchanged}, ` +
      `empty ${totalEmptySkipped}, schema-default ${totalSchemaDefaultSkipped}, ` +
      `deleted ${totalDeleted} across ${localFiles.length} environment(s).`,
  );
  if (totalEmptySkipped > 0) {
    console.log(
      `  ${totalEmptySkipped} key(s) are declared but blank locally — not pushed, and their remote values were left intact.`,
    );
  }
  if (totalSchemaDefaultSkipped > 0) {
    console.log(
      `  ${totalSchemaDefaultSkipped} variable(s) equal their env-schema default — not pushed, and pruned from GitHub so the runtime falls back to the same default (use --keep-schema-defaults to push them).`,
    );
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
