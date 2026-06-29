import { execSync } from 'node:child_process';
import * as logger from '@tooling/setup/common/logger.js';
import type { SetupConfig } from '@tooling/setup/common/types.js';

interface PrerequisiteCheck {
  name: string;
  command: string;
  versionFlag: string;
  required: boolean;
  enabledCheck?: (config: SetupConfig) => boolean;
  /** If set, run this to verify CLI login. Skipped when tokenEnvKey is set and present in env. */
  authCheck?: string;
  /** When set and this env var is non-empty (e.g. from .setup-credentials), treat as authenticated (API/token-based; no login). */
  tokenEnvKey?: string;
}

const PREREQUISITES: PrerequisiteCheck[] = [
  {
    name: 'Node.js',
    command: 'node',
    versionFlag: '--version',
    required: true,
  },
  {
    name: 'pnpm',
    command: 'pnpm',
    versionFlag: '--version',
    required: true,
  },
  {
    name: 'AWS CLI',
    command: 'aws',
    versionFlag: '--version',
    required: false,
    enabledCheck: (config) => config.providers.aws.enabled,
  },
  {
    name: 'GitHub CLI',
    command: 'gh',
    versionFlag: '--version',
    required: false,
    enabledCheck: (config) => config.providers.github.enabled,
    authCheck: 'gh auth status',
    tokenEnvKey: 'GITHUB_TOKEN',
  },
  {
    name: 'Railway CLI',
    command: 'railway',
    versionFlag: '--version',
    required: false,
    enabledCheck: (config) => config.providers.railway.enabled,
    authCheck: 'railway whoami',
    tokenEnvKey: 'RAILWAY_API_TOKEN',
  },
];

function commandExists(command: string, versionFlag: string): string | null {
  try {
    const output = execSync(`${command} ${versionFlag}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return output.trim().split('\n')[0] ?? output.trim();
  } catch {
    return null;
  }
}

function isAuthenticated(authCommand: string): boolean {
  try {
    execSync(authCommand, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

export function checkPrerequisites(config: SetupConfig): boolean {
  logger.info('Checking prerequisites...');
  logger.blank();

  let allPassed = true;

  for (const prerequisite of PREREQUISITES) {
    if (prerequisite.enabledCheck && !prerequisite.enabledCheck(config)) {
      logger.info(`${prerequisite.name} — skipped (provider disabled)`);
      continue;
    }

    const version = commandExists(prerequisite.command, prerequisite.versionFlag);

    if (version === null) {
      if (prerequisite.required) {
        logger.error(`${prerequisite.name} — NOT FOUND (required)`);
        allPassed = false;
      } else {
        logger.warn(`${prerequisite.name} — NOT FOUND (needed for ${prerequisite.name} provider)`);
        allPassed = false;
      }
      continue;
    }

    logger.success(`${prerequisite.name} — ${version}`);

    if (prerequisite.authCheck || prerequisite.tokenEnvKey) {
      const tokenValue = prerequisite.tokenEnvKey
        ? (process.env[prerequisite.tokenEnvKey] ?? '').trim()
        : '';
      const hasToken = tokenValue.length > 0;
      if (hasToken) {
        logger.success(`  └─ authenticated (${prerequisite.tokenEnvKey} from env)`);
      } else if (prerequisite.authCheck && isAuthenticated(prerequisite.authCheck)) {
        logger.success(`  └─ authenticated`);
      } else {
        const hint = prerequisite.tokenEnvKey
          ? `set ${prerequisite.tokenEnvKey} in .setup-credentials or run: ${prerequisite.authCheck?.split(' ').slice(0, 2).join(' ') ?? ''} login`
          : `run: ${prerequisite.authCheck?.split(' ').slice(0, 2).join(' ')} login`;
        logger.warn(`  └─ NOT authenticated — ${hint}`);
        allPassed = false;
      }
    }
  }

  logger.blank();

  if (!allPassed) {
    logger.error('Some prerequisites are missing. Install them before running setup.');
  }

  return allPassed;
}
