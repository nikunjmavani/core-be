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
 *   pnpm setup:infra --providers neon,jwt,github
 *   SETUP_INFRA_PROVIDERS=neon,jwt pnpm setup:infra --yes
 */
import { loadEnvSetupIntoProcess } from '@tooling/setup/common/secrets.js';
import { reportSetupError } from '@tooling/setup/common/setup-error.js';
import * as logger from '@tooling/setup/common/logger.js';
import {
  runProvision,
  runCheck,
  runStatus,
  runPreview,
  runDeleteInstructions,
  getAvailableProviderKeys,
} from './orchestrator.js';
import type { ProviderSelectionInput } from './orchestrator.js';

const args = process.argv.slice(2);

loadEnvSetupIntoProcess();

function getCommand(): string {
  if (args.includes('--help') || args.includes('-h')) return 'help';
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
  const includeKeys = parseProviderList('--providers') ?? parseProviderList('--only-providers');
  const skipKeys = parseProviderList('--skip-providers');
  return {
    ...(includeKeys !== undefined ? { includeKeys } : {}),
    ...(skipKeys !== undefined ? { skipKeys } : {}),
  };
}

function printHelp(): void {
  const providerKeys = getAvailableProviderKeys().join(', ');
  logger.info('Usage:');
  logger.info('  pnpm setup:infra                         Full provisioning (interactive)');
  logger.info('  pnpm setup:infra --yes                   Headless provisioning');
  logger.info('  pnpm setup:infra --check                 Health check selected providers');
  logger.info('  pnpm setup:infra --status                Show provisioned resources');
  logger.info('  pnpm setup:infra --dry-run               Preview selected providers');
  logger.info('  pnpm setup:infra --delete                Print manual-delete dashboard URLs');
  logger.blank();
  logger.info('Provider selection:');
  logger.info('  --providers neon,jwt,github              Run only these provider keys');
  logger.info('  --skip-providers postman,oauth           Run all except these provider keys');
  logger.info(
    '  SETUP_INFRA_PROVIDERS=neon,jwt           Env allow-list for AI/automation prompts',
  );
  logger.info('  SETUP_INFRA_SKIP_PROVIDERS=postman       Env skip-list for AI/automation prompts');
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
      case 'check':
        await runCheck({ providerSelection });
        break;
      case 'status':
        runStatus();
        break;
      case 'dry-run':
      case 'preview':
        runPreview({ providerSelection });
        break;
      case 'delete':
        if (args.includes('--revert') || args.includes('--revert-all')) {
          logger.warn(
            '--revert is deprecated — setup:infra never deletes resources. Use --delete to print manual deletion guidance.',
          );
        }
        runDeleteInstructions({ providerSelection });
        break;
      case 'provision':
        await runProvision({ providerSelection });
        break;
      default:
        logger.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    logger.blank();
    process.exit(reportSetupError(error, logger));
  }
}

const isMainModule = process.argv[1]?.includes('infra/infra');

if (isMainModule) {
  void main();
}
