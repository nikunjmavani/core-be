/**
 * Writes .env.<environmentName> files at project root by copying .env.example
 * and replacing known values from provisioned state. The .env.example structure
 * (comments, sections, variable ordering, and the Secrets vs Variables split)
 * is preserved exactly — only values for keys that setup manages are replaced.
 *
 * When a .env.<environment> file already exists, it is regenerated from the
 * .env.example template: provisioned keys always get fresh values from state,
 * while non-provisioned keys keep their existing values (preserving user edits).
 *
 * Use refreshEnvFiles() internally when a subprocess needs up-to-date values
 * (always regenerates, discarding user edits for provisioned keys).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { loadConfig, getEnvironmentNames } from '@tooling/setup/common/config.js';
import { loadSecrets } from '@tooling/setup/common/secrets.js';
import { loadState } from '@tooling/setup/common/state.js';
import { buildEnvironmentVariables } from './build-env-vars.js';
import * as logger from '@tooling/setup/common/logger.js';
import type {
  EnvironmentVariables,
  SetupConfig,
  SetupSecrets,
  SetupState,
} from '@tooling/setup/common/types.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../');

const ENV_KEY_RE = /^([A-Z][A-Z0-9_]*)=(.*)/;

/**
 * Encode a value for a `.env` file so dotenv reads it back identically.
 *
 * - Empty strings: emit bare empty (no quotes).
 * - Multi-line values (e.g. PEM keys): emit verbatim multi-line, single-quoted.
 *   Inside single quotes dotenv preserves all bytes (including newlines and
 *   backslashes) without escape processing — round-trip safe.
 * - Single-line values containing whitespace/special chars: double-quote and
 *   escape backslashes/quotes per dotenv conventions.
 */
function escapeEnvValue(value: string): string {
  if (value === '') return '';
  if (value.includes('\n') || value.includes('\r')) {
    if (value.includes("'")) {
      const doubled = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `"${doubled}"`;
    }
    return `'${value}'`;
  }
  const hasSpecial = /[\s#"'\\]/.test(value);
  if (!hasSpecial) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Parses KEY=value pairs from a dotenv file into LOGICAL values.
 *
 * Uses `dotenv.parse` so quoted values, escape sequences (`\n`, `\"`, `\\`),
 * and multi-line single-quoted blocks (e.g. PEM keys) are unwrapped to their
 * runtime string. Pairing this with `escapeEnvValue` on write is round-trip
 * safe — without it, every regen would re-escape quotes/backslashes and the
 * file would grow `\` characters and quote nesting on every `setup:infra` run.
 */
function parseEnvValues(filePath: string): Map<string, string> {
  if (!existsSync(filePath)) return new Map();
  const content = readFileSync(filePath, 'utf-8');
  const parsed = dotenv.parse(content);
  return new Map(Object.entries(parsed));
}

/**
 * Builds .env.<environment> content from .env.example, replacing every
 * KEY=VALUE line whose key is in the provisioned variables. Non-provisioned
 * keys keep their .env.example default unless existingValues has an override.
 */
function buildEnvContent(
  environmentName: string,
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
  existingValues?: Map<string, string>,
): string {
  const examplePath = resolve(PROJECT_ROOT, '.env.example');
  if (!existsSync(examplePath)) {
    throw new Error('.env.example not found at project root');
  }

  const template = readFileSync(examplePath, 'utf-8');
  const provisioned = buildEnvironmentVariables(environmentName, config, secrets, state);

  const lines = template.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(ENV_KEY_RE);
    if (match) {
      const key = match[1];
      if (key === undefined) {
        result.push(line);
        continue;
      }

      // Provisioned keys always get fresh values from state.
      if (key in provisioned) {
        const value = provisioned[key as keyof EnvironmentVariables];
        const raw = typeof value === 'string' ? value : String(value ?? '');
        result.push(`${key}=${escapeEnvValue(raw)}`);
        continue;
      }

      // Non-provisioned keys: preserve existing value if present, else keep default.
      const existingValue = existingValues?.get(key);
      if (existingValue !== undefined) {
        result.push(`${key}=${escapeEnvValue(existingValue)}`);
        continue;
      }
    }
    result.push(line);
  }

  return result.join('\n');
}

export interface ExportResult {
  written: string[];
  merged: string[];
}

/**
 * Writes .env.<environment> for each environment using .env.example as the
 * template. New files are created fresh. Existing files are regenerated from
 * the template — provisioned keys get fresh values, non-provisioned keys
 * keep their existing values (preserving user edits). Missing keys from
 * .env.example are automatically added in the correct sections.
 */
export function exportEnvFiles(): ExportResult {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();
  const environments = getEnvironmentNames(config);

  const written: string[] = [];
  const merged: string[] = [];

  for (const environmentName of environments) {
    const filePath = resolve(PROJECT_ROOT, `.env.${environmentName}`);

    if (existsSync(filePath)) {
      const existingValues = parseEnvValues(filePath);
      const content = buildEnvContent(environmentName, config, secrets, state, existingValues);
      writeFileSync(filePath, content, 'utf-8');
      merged.push(`.env.${environmentName}`);
    } else {
      const content = buildEnvContent(environmentName, config, secrets, state);
      writeFileSync(filePath, content, 'utf-8');
      written.push(`.env.${environmentName}`);
    }
  }

  return { written, merged };
}

/**
 * Always regenerates .env.<environment> files from .env.example with fresh
 * provisioned values. Existing file values are NOT preserved — used by
 * provider steps (e.g. Postman) that need to invoke a subprocess with the
 * very latest provisioned env.
 */
export function refreshEnvFiles(): string[] {
  const config = loadConfig();
  const secrets = loadSecrets(config);
  const state = loadState();
  const environments = getEnvironmentNames(config);

  const written: string[] = [];

  for (const environmentName of environments) {
    const content = buildEnvContent(environmentName, config, secrets, state);
    const filePath = resolve(PROJECT_ROOT, `.env.${environmentName}`);
    writeFileSync(filePath, content, 'utf-8');
    written.push(`.env.${environmentName}`);
  }

  return written;
}

/**
 * Run from CLI (pnpm setup:envs). Exits on missing config/state.
 */
export function runExportEnv(): void {
  logger.info('Exporting environment variables to .env.<environment> files...');
  logger.blank();

  const { written, merged } = exportEnvFiles();

  if (written.length > 0) {
    logger.success(`Created ${written.length} file(s): ${written.join(', ')}`);
  }
  if (merged.length > 0) {
    logger.info(
      `Regenerated ${merged.length} existing file(s) with all .env.example keys: ${merged.join(', ')}`,
    );
  }
  if (written.length === 0 && merged.length === 0) {
    logger.info('No environments configured. Check tooling/setup/setup.config.json.');
  }
}
