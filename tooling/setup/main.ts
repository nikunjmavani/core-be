import {
  runProvision,
  runCheck,
  runStatus,
  runUpdate,
  runRevertAll,
  runPreview,
} from './orchestrator.js';
import { runInitWizard } from './init-wizard.js';
import { runExportEnv } from './export-env-files.js';
import { loadEnvSetupIntoProcess } from './env-secrets.js';
import * as logger from './logger.util.js';

const args = process.argv.slice(2);

loadEnvSetupIntoProcess();

function getCommand(): string {
  if (args.includes('--init')) return 'init';
  if (args.includes('--preview')) return 'preview';
  if (args.includes('--check')) return 'check';
  if (args.includes('--status')) return 'status';
  if (args.includes('--update')) return 'update';
  if (args.includes('--revert-all')) return 'revert-all';
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
      case 'provision':
        await runProvision();
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
      case 'revert-all':
        await runRevertAll();
        break;
      case 'export-env':
        runExportEnv();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        logger.info('Usage:');
        logger.info(
          '  pnpm setup:infra:init    Interactive: ask org, project, envs → generate config',
        );
        logger.info('  pnpm setup:infra        Full provisioning (double confirm, atomic)');
        logger.info(
          '  pnpm setup:infra:preview Show providers + token instructions (no provisioning)',
        );
        logger.info('  pnpm setup:infra:check  Health check all resources');
        logger.info('  pnpm setup:infra:status Show provisioning status');
        logger.info(
          '  pnpm setup:infra:update Re-sync GitHub branches, rulesets, environments, and secrets',
        );
        logger.info(
          '  pnpm github:sync        Full GitHub sync (consistency + scaffold + remote + values)',
        );
        logger.info('  pnpm setup:infra:revert Revert all provisioned resources');
        logger.info(
          '  pnpm setup:infra:export-env Write .env.<environment> files for GitHub Environment secrets',
        );
        process.exit(1);
    }
  } catch (error) {
    logger.blank();
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
