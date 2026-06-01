/**
 * CLI entry for pnpm setup:github — standalone GitHub integration.
 *
 * Usage:
 *   pnpm setup:github              Full sync (branches + rulesets + envs + values)
 *   pnpm setup:github --check       Read-only drift report
 *   pnpm setup:github --dry-run     Preview what would be synced
 *   pnpm setup:github --status      Per-environment status dashboard
 */
import * as logger from '@tooling/setup/common/logger.js';
import { loadConfig } from '@tooling/setup/common/config.js';
import { buildGitHubStatus, printGitHubStatus } from './status.js';

const args = process.argv.slice(2);

function getCommand(): string {
  if (args.includes('--check')) return 'check';
  if (args.includes('--dry-run')) return 'dry-run';
  if (args.includes('--status')) return 'status';
  return 'sync';
}

async function main(): Promise<void> {
  const command = getCommand();

  try {
    if (command === 'status') {
      const config = loadConfig();
      const environments = config.environments.map((e) => ({ name: e.name, branch: e.branch }));
      const repository = config.providers.github.repository;
      const statuses = buildGitHubStatus(repository, environments);
      printGitHubStatus(statuses);
      return;
    }

    // For sync/check/dry-run, delegate to the existing sync module
    await import('./sync.js');
    // sync.ts has its own main() with CLI parsing — re-run via process
    // This is a thin delegator; the real logic is in sync.ts
    logger.info('Delegating to sync module...');
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.includes('github/github');

if (isMainModule) {
  void main();
}
