import {
  runProvision,
  runCheck,
  runStatus,
  runUpdate,
  runDeleteInstructions,
  runPreview,
  runReconstruct,
} from './infra/orchestrator.js';
import { runInitWizard } from './infra/init-wizard.js';
import { runExportEnv } from './envs/export-env-files.js';
import { loadEnvSetupIntoProcess } from './common/secrets.js';
import * as logger from './common/logger.js';

const args = process.argv.slice(2);
const assumeYes = args.includes('--yes') || args.includes('-y');

loadEnvSetupIntoProcess();

function getCommand(): string {
  if (args.includes('--init')) return 'init';
  if (args.includes('--preview')) return 'preview';
  if (args.includes('--dry-run')) return 'dry-run';
  if (args.includes('--reconstruct')) return 'reconstruct';
  if (args.includes('--check')) return 'check';
  if (args.includes('--status')) return 'status';
  if (args.includes('--update')) return 'update';
  if (
    args.includes('--delete') ||
    args.includes('--delete-instructions') ||
    args.includes('--revert') ||
    args.includes('--revert-all')
  ) {
    return 'delete';
  }
  if (args.includes('--export-env')) return 'export-env';
  return 'provision';
}

async function main(): Promise<void> {
  const command = getCommand();

  try {
    switch (command) {
      case 'init':
        await runInitWizard();
        break;
      case 'preview':
        runPreview();
        break;
      case 'dry-run':
        logger.info('Dry-run: full provisioning preview');
        runPreview();
        break;
      case 'reconstruct':
        await runReconstruct();
        break;
      case 'provision':
        await runProvision({ assumeYes });
        break;
      case 'check':
        await runCheck();
        break;
      case 'status':
        runStatus();
        break;
      case 'update':
        await runUpdate();
        break;
      case 'delete':
        if (args.includes('--revert') || args.includes('--revert-all')) {
          logger.warn(
            '--revert is deprecated — setup:infra never deletes resources. Use --delete to print manual deletion guidance.',
          );
        }
        runDeleteInstructions();
        break;
      case 'export-env':
        runExportEnv();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Usage:');
        logger.info('  pnpm setup --init           Generate setup.config.json + .env.setup');
        logger.info('  pnpm setup                  Full interactive provisioning');
        logger.info('  pnpm setup --preview        Show providers + token URLs (no API calls)');
        logger.info('  pnpm setup --dry-run        Full dry-run of all steps');
        logger.info('  pnpm setup --status         All-environments dashboard');
        logger.info('  pnpm setup --reconstruct    Rebuild state from remote APIs');
        logger.info('  pnpm setup:infra --check    Health check all providers');
        logger.info(
          '  pnpm setup:infra --delete   Print manual-delete dashboard URLs (no resources removed)',
        );
        logger.info('  pnpm setup:github           Full GitHub sync');
        logger.info('  pnpm setup:envs             Write .env files from state');
        process.exit(1);
    }
  } catch (error) {
    logger.blank();
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
