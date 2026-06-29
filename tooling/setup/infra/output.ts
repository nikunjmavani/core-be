/**
 * `pnpm setup:infra:output` — inspect resolved env outputs (secrets masked).
 *
 * No secret value is EVER printed. The default view is a masked inventory (non-secret
 * values shown, secrets `••••`). To obtain a secret value, `--copy <KEY>` puts it on the
 * system clipboard (never stdout, so it never enters the terminal / agent transcript),
 * auto-clears after a timeout, and records the reveal (key + env + timestamp, never the
 * value) to a gitignored audit log.
 *
 * For normal setup you never need this: provisioning / `setup:infra:export-env` write every
 * value straight into `.env.<environment>` — the one home for secrets.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names come
 * from `config.project.*` and environment names from `config.environments[].name`.
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, getEnvironmentNames } from '@tooling/setup/common/config.js';
import { loadSecrets } from '@tooling/setup/common/secrets.js';
import { loadState } from '@tooling/setup/common/state.js';
import { SetupError } from '@tooling/setup/common/setup-error.js';
import { buildEnvironmentVariables } from '@tooling/setup/envs/build-env-vars.js';
import {
  clearClipboard,
  clipboardAvailable,
  copyToClipboard,
} from '@tooling/setup/common/clipboard.js';
import * as logger from '@tooling/setup/common/logger.js';

const AUDIT_LOG_PATH = resolve(import.meta.dirname, '../../../.setup-state.audit.log');
const CLIPBOARD_CLEAR_SECONDS = 20;

/** Keys whose VALUES are sensitive and must be masked / clipboard-only. */
const SENSITIVE_PATTERN = /(SECRET|TOKEN|PASSWORD|DSN|PRIVATE|KEY|ENCRYPTION)/i;

/** Connection strings with embedded credentials (`scheme://user:pass@host`) — always masked. */
const CREDENTIAL_URL_PATTERN = /:\/\/[^/\s:@]+:[^/\s@]+@/;

/** Pattern-matching keys that are nonetheless public/non-sensitive — never masked. */
const PUBLIC_KEY_ALLOWLIST = new Set([
  'JWT_SIGNING_KID',
  'JWT_PUBLIC_KEY',
  'SCALAR_NAMESPACE',
  'SCALAR_SLUG',
  'CAPTCHA_SITE_KEY',
  'OAUTH_GOOGLE_CLIENT_ID',
  'OAUTH_GITHUB_CLIENT_ID',
  'POSTHOG_KEY', // PostHog project key is public by design (ships to the browser)
]);

export interface OutputOptions {
  /** Limit to a single environment name (from config.environments[].name). */
  environment?: string;
  /** Copy the real value of exactly this one key to the clipboard (audit-logged). */
  copy?: string;
}

export function isSensitive(key: string, value: string): boolean {
  if (CREDENTIAL_URL_PATTERN.test(value)) return true;
  if (PUBLIC_KEY_ALLOWLIST.has(key)) return false;
  return SENSITIVE_PATTERN.test(key);
}

function mask(value: string): string {
  return value.length === 0 ? '(empty)' : '••••••••';
}

function recordReveal(key: string, environment: string): void {
  try {
    appendFileSync(
      AUDIT_LOG_PATH,
      `${new Date().toISOString()} copied ${key} for ${environment}\n`,
      'utf-8',
    );
  } catch {
    // Audit logging is best-effort; never block a copy on it.
  }
}

function resolveEnvironments(config: ReturnType<typeof loadConfig>, requested?: string): string[] {
  const all = getEnvironmentNames(config);
  if (!requested) return all;
  const match = all.filter((name) => name === requested);
  if (match.length === 0) {
    throw new SetupError(`Unknown environment "${requested}". Configured: ${all.join(', ')}`);
  }
  return match;
}

/** `--copy <KEY>`: copy one value to the clipboard, never printing it. */
async function copyValueToClipboard(options: OutputOptions & { copy: string }): Promise<void> {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();
  // Default to the single configured default environment when none is given.
  const environment =
    options.environment ??
    config.environments.find((candidate) => candidate.isDefault)?.name ??
    getEnvironmentNames(config)[0];

  if (!environment) {
    throw new SetupError('No environments configured.');
  }

  const variables = buildEnvironmentVariables(environment, config, secrets, state);
  const value = String(variables[options.copy as keyof typeof variables] ?? '');

  if (value.length === 0) {
    throw new SetupError(`"${options.copy}" is empty or not set for "${environment}".`);
  }

  if (!clipboardAvailable()) {
    throw new SetupError('No clipboard tool found (need pbcopy / wl-copy / xclip / xsel / clip).', {
      hint: `Read the value from .env.${environment} directly — it is never printed.`,
    });
  }

  if (!copyToClipboard(value)) {
    throw new SetupError('Failed to write to the clipboard.');
  }

  recordReveal(options.copy, environment);
  logger.success(
    `${options.copy} for "${environment}" → copied to clipboard (not shown). Clearing in ${CLIPBOARD_CLEAR_SECONDS}s…`,
  );

  await new Promise((done) => setTimeout(done, CLIPBOARD_CLEAR_SECONDS * 1000));
  clearClipboard();
  logger.info('Clipboard cleared.');
}

/** Render the masked inventory for each environment (no secret value is printed). */
function printMaskedInventory(options: OutputOptions): void {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();
  const environments = resolveEnvironments(config, options.environment);

  logger.info(`Project: ${config.project.displayName} (${config.project.name})`);
  logger.info(`Organization: ${config.project.organization}`);
  logger.blank();

  for (const environment of environments) {
    const variables = buildEnvironmentVariables(environment, config, secrets, state);
    logger.info(`# ${environment}`);
    for (const key of Object.keys(variables).sort()) {
      const value = String(variables[key as keyof typeof variables] ?? '');
      logger.info(`  ${key} = ${isSensitive(key, value) ? `${mask(value)}  (sensitive)` : value}`);
    }
    logger.blank();
  }

  logger.info(
    'Secrets are never printed. Copy one to the clipboard: pnpm setup:infra:output --copy <KEY>',
  );
  logger.info('Or just provision — values are written straight into .env.<environment>.');
}

/** Entry point for `setup:infra:output`. */
export async function runOutput(options: OutputOptions = {}): Promise<void> {
  if (options.copy) {
    await copyValueToClipboard({ ...options, copy: options.copy });
    return;
  }
  printMaskedInventory(options);
}
