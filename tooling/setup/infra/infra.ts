/**
 * CLI entry for pnpm setup:infra — standalone infrastructure provisioning.
 *
 * Usage:
 *   pnpm setup:infra              Full provisioning (interactive)
 *   pnpm setup:infra --yes        Headless provisioning
 *   pnpm setup:infra --check      Health check all providers
 *   pnpm setup:infra --status     Show provisioned resources
 *   pnpm setup:infra --dry-run    Preview what would be created
 *   pnpm setup:infra --delete     Print manual-delete dashboard URLs
 *                                 (script never deletes anything; --revert is
 *                                 a back-compat alias)
 */
import { loadEnvSetupIntoProcess } from '../common/secrets.js';
import * as logger from '../common/logger.js';
import {
  runProvision,
  runCheck,
  runStatus,
  runPreview,
  runDeleteInstructions,
} from './orchestrator.js';

const args = process.argv.slice(2);
const assumeYes = args.includes('--yes') || args.includes('-y');

loadEnvSetupIntoProcess();

function getCommand(): string {
  if (args.includes('--check')) return 'check';
  if (args.includes('--status')) return 'status';
  if (args.includes('--dry-run')) return 'dry-run';
  if (args.includes('--preview')) return 'preview';
  if (
    args.includes('--delete') ||
    args.includes('--delete-instructions') ||
    args.includes('--revert') ||
    args.includes('--revert-all')
  ) {
    return 'delete';
  }
  return 'provision';
}

async function main(): Promise<void> {
  const command = getCommand();

  try {
    switch (command) {
      case 'check':
        await runCheck();
        break;
      case 'status':
        runStatus();
        break;
      case 'dry-run':
      case 'preview':
        runPreview();
        break;
      case 'delete':
        if (args.includes('--revert') || args.includes('--revert-all')) {
          logger.warn(
            '--revert is deprecated — setup:infra never deletes resources. Use --delete to print manual deletion guidance.',
          );
        }
        runDeleteInstructions();
        break;
      case 'provision':
        await runProvision({ assumeYes });
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Usage: pnpm setup:infra [--check|--status|--dry-run|--delete]');
        process.exit(1);
    }
  } catch (error) {
    logger.blank();
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.includes('infra/infra');

if (isMainModule) {
  main();
}
