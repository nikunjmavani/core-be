/**
 * Full reconciliation of GitHub Environments against local .env.<environment> files.
 *
 * For every configured environment:
 *   - Items in the local .env file but missing on GitHub → created.
 *   - Variables with changed values → updated.
 *   - Secrets are always re-encrypted and pushed (GitHub hides values).
 *   - Items on GitHub but NOT in the local file → DELETED (file is source of truth).
 *   - Variables with unchanged values → skipped.
 *
 * Usage:
 *   pnpm envs:sync:github                  # reconcile ALL environments
 *   pnpm envs:sync:github --env production  # reconcile a single environment
 *   pnpm envs:sync:github --dry-run         # preview only, no writes
 *   pnpm envs:sync:github --yes             # skip confirmation
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { loadConfig, getEnvironmentNames } from '@tooling/setup/common/config.js';
import { syncEnvironmentToGitHub } from '@tooling/setup/github/sync-github-environments.js';
import * as logger from '@tooling/setup/common/logger.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../');

function isInteractiveShell(): boolean {
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: pnpm envs:sync:github [--env <name>] [--dry-run] [--yes]');
    console.log('');
    console.log('  (default)  Reconcile ALL configured environments');
    console.log('  --env <name>  Reconcile a single environment');
    console.log('  --dry-run     Preview only, no API calls');
    console.log('  --yes         Skip confirmation prompt');
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const skipConfirmation = args.includes('--yes') || args.includes('-y');
  const envIdx = args.indexOf('--env');
  const requestedEnv = envIdx >= 0 ? args[envIdx + 1] : undefined;

  const config = loadConfig();
  const allEnvironments = getEnvironmentNames(config);

  const environments = requestedEnv ? [requestedEnv] : allEnvironments;

  // Validate
  for (const env of environments) {
    if (!allEnvironments.includes(env)) {
      logger.error(
        `${env} is not in setup.config.json. Environments: ${allEnvironments.join(', ')}`,
      );
      process.exit(1);
    }
  }

  // Check local files exist
  const localFiles: string[] = [];
  for (const env of environments) {
    const filePath = resolve(PROJECT_ROOT, `.env.${env}`);
    if (!existsSync(filePath)) {
      logger.error(`Missing .env.${env}. Run pnpm envs:sync:local first.`);
      process.exit(1);
    }
    localFiles.push(env);
  }

  logger.info(`Reconciling GitHub Environments: ${localFiles.join(', ')}`);
  logger.blank();

  // Confirmation
  if (!(dryRun || skipConfirmation)) {
    if (!isInteractiveShell()) {
      logger.error('Non-interactive shell — re-run with --yes to push.');
      process.exit(1);
    }
    logger.warn('This reconciles GitHub Environments against local .env files.');
    logger.warn('Items on GitHub NOT in the local file will be DELETED.');
    logger.blank();
    const confirmed = await askExactPhrase('Type "sync" to proceed: ', 'sync');
    if (!confirmed) {
      logger.info('Aborted.');
      process.exit(0);
    }
    logger.blank();
  }

  let totalPushed = 0;
  let totalSkipped = 0;
  let totalDeleted = 0;
  let failures = 0;

  for (const env of localFiles) {
    logger.divider();
    try {
      const result = await syncEnvironmentToGitHub({
        environment: env,
        dryRun,
        skipCreate: false,
        skipPreflight: true,
      });
      totalPushed += result.pushed;
      totalSkipped += result.skipped;
      totalDeleted += result.deleted;
    } catch (error) {
      failures += 1;
      logger.error(`${env}: ${error instanceof Error ? error.message : String(error)}`);
    }
    logger.blank();
  }

  if (failures > 0) {
    logger.error(`Sync finished with ${failures} failure(s).`);
    process.exit(1);
  }

  if (dryRun) {
    logger.info('Dry run complete — no changes made.');
    process.exit(0);
  }

  logger.success(
    `Sync complete — pushed ${totalPushed}, skipped ${totalSkipped}, deleted ${totalDeleted} across ${localFiles.length} environment(s).`,
  );
}

void main();
