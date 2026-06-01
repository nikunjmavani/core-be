/**
 * CLI entry for pnpm setup:envs — standalone environment variable management.
 *
 * Usage:
 *   pnpm setup:envs                Export .env.<env> files from state
 *   pnpm setup:envs --check         Validate .env.<env> against schema
 *   pnpm setup:envs --diff <env>    Diff local .env.<env> vs GitHub
 *   pnpm setup:envs --clone <src> <dst> Clone env config to another
 */
import * as logger from '@tooling/setup/common/logger.js';
import { loadConfig, getEnvironmentNames } from '@tooling/setup/common/config.js';
import { runExportEnv } from './export-env-files.js';
import { printEnvValidation } from './validate.js';
import { printDiff } from './diff.js';
import { cloneEnvFile } from './clone.js';

const args = process.argv.slice(2);

function getCommand(): string {
  if (args.includes('--check')) return 'check';
  if (args.includes('--diff')) return 'diff';
  if (args.includes('--clone')) return 'clone';
  return 'export';
}

async function main(): Promise<void> {
  const command = getCommand();

  try {
    switch (command) {
      case 'export': {
        runExportEnv();
        break;
      }
      case 'check': {
        const config = loadConfig();
        const environments = getEnvironmentNames(config);
        const allValid = printEnvValidation(environments);
        if (!allValid) process.exit(1);
        break;
      }
      case 'diff': {
        const envIdx = args.indexOf('--diff');
        const env = args[envIdx + 1];
        if (!env) {
          logger.error('Missing environment name. Usage: pnpm setup:envs --diff <environment>');
          process.exit(1);
        }
        printDiff(env);
        break;
      }
      case 'clone': {
        const srcIdx = args.indexOf('--clone');
        const src = args[srcIdx + 1];
        const dst = args[srcIdx + 2];
        if (!(src && dst)) {
          logger.error('Usage: pnpm setup:envs --clone <source> <target>');
          process.exit(1);
        }
        cloneEnvFile(src, dst);
        break;
      }
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Usage: pnpm setup:envs [--check|--diff <env>|--clone <src> <dst>]');
        process.exit(1);
    }
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.includes('envs/envs');

if (isMainModule) {
  void main();
}
