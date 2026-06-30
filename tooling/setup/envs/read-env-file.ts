/**
 * Reads a single value from a per-environment `.env.<environment>` file at the project root.
 *
 * Used by validate-only providers (Stripe, Turnstile) whose app secrets live directly in
 * `.env.<environment>` (not in `.setup/.setup-credentials`) — the environment dimension is the
 * file, not a key suffix. Returns `undefined` when the file is absent or the key is empty.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

function envFilePath(environmentName: string): string {
  return resolve(PROJECT_ROOT, `.env.${environmentName}`);
}

/**
 * Read one key's value from `.env.<environmentName>`.
 *
 * @remarks
 * **Side effects:** reads the env file from disk (no mutation). **Failure modes:** returns
 * `undefined` if the file does not exist or the key is missing/empty; never throws.
 */
export function readEnvFileValue(environmentName: string, key: string): string | undefined {
  const filePath = envFilePath(environmentName);
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = dotenv.parse(readFileSync(filePath, 'utf-8'));
    const value = parsed[key];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write (replace in place, or append) a single `KEY=value` into `.env.<environmentName>`.
 *
 * @remarks
 * **Algorithm:** if a line `^KEY=` exists it is replaced, preserving every other line and
 * ordering; otherwise the pair is appended. The value is written verbatim (callers pass raw
 * secrets — never interpolated into a shell). **Side effects:** writes the env file to disk.
 * **Failure modes:** returns `false` if `.env.<environmentName>` does not exist (this helper
 * never creates the file); returns `true` on a successful write.
 */
export function setEnvFileValue(environmentName: string, key: string, value: string): boolean {
  const filePath = envFilePath(environmentName);
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf-8');
  const lineRegex = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=.*$`, 'm');
  const next = lineRegex.test(content)
    ? content.replace(lineRegex, `${key}=${value}`)
    : `${content.replace(/\n*$/, '')}\n${key}=${value}\n`;
  writeFileSync(filePath, next, 'utf-8');
  return true;
}

/**
 * Like {@link setEnvFileValue}, but CREATES `.env.<environmentName>` if it does not exist yet.
 *
 * @remarks
 * Used by the interactive credential collector (validate-only providers), which can run before
 * the export-env step has materialized the file. A freshly-created file holds just this line;
 * the later preserving export (`exportEnvFiles`) keeps it. **Side effects:** writes/creates the
 * env file. Always succeeds (no return value).
 */
export function upsertEnvFileValue(environmentName: string, key: string, value: string): void {
  const filePath = envFilePath(environmentName);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${key}=${value}\n`, 'utf-8');
    return;
  }
  setEnvFileValue(environmentName, key, value);
}
