/**
 * Helpers for setup:infra providers whose inputs live in `.env.<environment>` rather than
 * `.setup/.setup-credentials`.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { createReadline, question, questionHidden } from '@tooling/setup/common/prompts.js';
import { isSecretFilled } from '@tooling/setup/common/secrets.js';
import type { SetupConfig } from '@tooling/setup/common/types.js';
import { readEnvFileValue, upsertEnvFileValue } from './read-env-file.js';

/** Default environment from config (`isDefault` flag, else first listed). */
export function resolveDefaultEnvironmentName(config: SetupConfig): string {
  return (
    config.environments.find((environment) => environment.isDefault)?.name ??
    config.environments[0]?.name ??
    'development'
  );
}

/** OAuth app display name: `core-be-development` for dev, `core-be` for production. */
export function oauthAppDisplayName(projectName: string, environmentName: string): string {
  return environmentName === 'production' ? projectName : `${projectName}-${environmentName}`;
}

/** Frontend base URL for guide steps; development falls back to localhost. */
export function frontendUrlForEnvironment(config: SetupConfig, environmentName: string): string {
  const configured = config.app.frontendUrl[environmentName];
  if (configured && configured.trim().length > 0) return configured.trim();
  if (environmentName === 'development') return 'http://localhost:3000';
  return '';
}

export function anyEnvironmentHasEnvKey(config: SetupConfig, key: string): boolean {
  return config.environments.some((environment) =>
    isSecretFilled(readEnvFileValue(environment.name, key)),
  );
}

export function everyEnvironmentHasEnvKeys(config: SetupConfig, keys: string[]): boolean {
  return config.environments.every((environment) =>
    keys.every((key) => isSecretFilled(readEnvFileValue(environment.name, key))),
  );
}

export function readDefaultEnvironmentCredentials(
  config: SetupConfig,
  keys: string[],
): Record<string, string | undefined> {
  const environmentName = resolveDefaultEnvironmentName(config);
  const out: Record<string, string | undefined> = {};
  for (const key of keys) {
    out[key] = readEnvFileValue(environmentName, key);
  }
  return out;
}

/** One credential the collector asks for via stdin and writes to `.env.<environment>`. */
export interface EnvCredentialField {
  /** Env-file key, e.g. `OAUTH_GOOGLE_CLIENT_ID`. */
  key: string;
  /** Human label shown at the prompt. */
  label: string;
  /** Mask input (password-style) — use for secrets. */
  secret?: boolean;
  /** Computed default offered at the prompt (e.g. a redirect URI). */
  defaultValue?: (config: SetupConfig, environmentName: string) => string;
}

export interface CollectEnvCredentialsOptions {
  providerName: string;
  fields: EnvCredentialField[];
  /**
   * `per-environment` (default): prompt for every enabled environment (separate apps/keys).
   * `account`: prompt once and write the same value to every enabled environment.
   */
  scope?: 'per-environment' | 'account';
}

async function promptField(field: EnvCredentialField, defaultValue: string): Promise<string> {
  if (field.secret) {
    const hint = ' (Enter to keep current)';
    return questionHidden(`  ${field.label}${hint}: `);
  }
  const readline = createReadline();
  try {
    return await question(readline, `  ${field.label}`, defaultValue);
  } finally {
    readline.close();
  }
}

/**
 * Interactively collect a validate-only provider's credentials from stdin and write them into
 * `.env.<environment>` for every enabled environment in `config.environments`.
 *
 * @remarks
 * **Inputs come from stdin only** — never read from the env file as a source. Secrets are
 * masked. An empty answer keeps whatever is already on disk (idempotent re-runs). For
 * `account` scope the prompt runs once and the value is written to every environment; for
 * `per-environment` scope each environment is prompted separately (e.g. separate OAuth apps).
 * **Side effects:** writes/creates `.env.<environment>` via `upsertEnvFileValue`. The guide for
 * *where/what to create* is printed by the provider's step instructions before this runs.
 */
export async function collectEnvCredentials(
  config: SetupConfig,
  options: CollectEnvCredentialsOptions,
): Promise<void> {
  const { providerName, fields, scope = 'per-environment' } = options;
  const environments = config.environments.map((environment) => environment.name);
  logger.blank();
  logger.info(`Enter ${providerName} credentials (press Enter to keep the current value):`);

  if (scope === 'account') {
    const collected: Array<[string, string]> = [];
    for (const field of fields) {
      const value = await promptField(field, '');
      if (value) collected.push([field.key, value]);
    }
    for (const environmentName of environments) {
      for (const [key, value] of collected) {
        upsertEnvFileValue(environmentName, key, value);
      }
    }
    return;
  }

  for (const environmentName of environments) {
    logger.info(`  --- ${environmentName} (.env.${environmentName}) ---`);
    for (const field of fields) {
      const defaultValue = field.defaultValue?.(config, environmentName) ?? '';
      const value = await promptField(field, defaultValue);
      if (value) upsertEnvFileValue(environmentName, field.key, value);
    }
  }
}
