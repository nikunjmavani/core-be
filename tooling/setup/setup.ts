import {
  runProvision,
  runCheck,
  runStatus,
  runUpdate,
  runDeleteInstructions,
  runPreview,
  runReconstruct,
  getAvailableProviderKeys,
} from './infra/orchestrator.js';
import { runInitWizard } from './infra/init-wizard.js';
import { runExportEnv } from './envs/export-env-files.js';
import { loadEnvSetupIntoProcess } from './common/secrets.js';
import * as logger from './common/logger.js';
import type { ProviderSelectionInput } from './infra/orchestrator.js';

const args = process.argv.slice(2);
const assumeYes = args.includes('--yes') || args.includes('-y');

loadEnvSetupIntoProcess();

function getCommand(): string {
  if (args.includes('--help') || args.includes('-h')) return 'help';
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

function parseProviderList(flagName: string): string[] | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flagName}=`));
  const flagIndex = args.indexOf(flagName);
  const rawValue =
    inline?.slice(flagName.length + 1) ?? (flagIndex >= 0 ? args[flagIndex + 1] : undefined);
  if (!rawValue || rawValue.startsWith('--')) return undefined;
  return rawValue
    .split(',')
    .map((providerKey) => providerKey.trim().toLowerCase())
    .filter(Boolean);
}

function getProviderSelection(): ProviderSelectionInput {
  return {
    includeKeys: parseProviderList('--providers') ?? parseProviderList('--only-providers'),
    skipKeys: parseProviderList('--skip-providers'),
  };
}

function printHelp(): void {
  const providerKeys = getAvailableProviderKeys().join(', ');
  logger.info('Usage:');
  logger.info('  pnpm setup --init                    Generate setup.config.json + .env.setup');
  logger.info('  pnpm setup                           Full interactive provisioning');
  logger.info('  pnpm setup --preview                 Show providers + token URLs (no API calls)');
  logger.info('  pnpm setup --dry-run                 Full dry-run of selected steps');
  logger.info('  pnpm setup --status                  All-environments dashboard');
  logger.info('  pnpm setup --reconstruct             Rebuild state from remote APIs');
  logger.info('  pnpm setup --check                   Health check selected providers');
  logger.info(
    '  pnpm setup --update                  Re-sync update-capable providers (github today)',
  );
  logger.info(
    '  pnpm setup --delete                  Print manual-delete dashboard URLs (no resources removed)',
  );
  logger.blank();
  logger.info('Provider selection:');
  logger.info('  --providers neon,jwt,github           Run only these provider keys');
  logger.info('  --skip-providers postman,oauth        Run all except these provider keys');
  logger.info('  SETUP_INFRA_PROVIDERS=neon,jwt        Env allow-list for AI/automation prompts');
  logger.info('  SETUP_INFRA_SKIP_PROVIDERS=postman    Env skip-list for AI/automation prompts');
  logger.info(`  Available provider keys: ${providerKeys}`);
}

async function main(): Promise<void> {
  const command = getCommand();
  const providerSelection = getProviderSelection();

  try {
    switch (command) {
      case 'help':
        printHelp();
        break;
      case 'init':
        await runInitWizard();
        break;
      case 'preview':
        runPreview({ providerSelection });
        break;
      case 'dry-run':
        logger.info('Dry-run: full provisioning preview');
        runPreview({ providerSelection });
        break;
      case 'reconstruct':
        await runReconstruct({ providerSelection });
        break;
      case 'provision':
        await runProvision({ assumeYes, providerSelection });
        break;
      case 'check':
        await runCheck({ providerSelection });
        break;
      case 'status':
        runStatus();
        break;
      case 'update':
        await runUpdate({ providerSelection });
        break;
      case 'delete':
        if (args.includes('--revert') || args.includes('--revert-all')) {
          logger.warn(
            '--revert is deprecated — setup:infra never deletes resources. Use --delete to print manual deletion guidance.',
          );
        }
        runDeleteInstructions({ providerSelection });
        break;
      case 'export-env':
        runExportEnv();
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    logger.blank();
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
