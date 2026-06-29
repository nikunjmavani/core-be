/**
 * Reads a single value from a per-environment `.env.<environment>` file at the project root.
 *
 * Used by validate-only providers (Stripe, Turnstile) whose app secrets live directly in
 * `.env.<environment>` (not in `.setup/.setup-credentials`) — the environment dimension is the
 * file, not a key suffix. Returns `undefined` when the file is absent or the key is empty.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Read one key's value from `.env.<environmentName>`.
 *
 * @remarks
 * **Side effects:** reads the env file from disk (no mutation). **Failure modes:** returns
 * `undefined` if the file does not exist or the key is missing/empty; never throws.
 */
export function readEnvFileValue(environmentName: string, key: string): string | undefined {
  const filePath = resolve(PROJECT_ROOT, `.env.${environmentName}`);
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = dotenv.parse(readFileSync(filePath, 'utf-8'));
    const value = parsed[key];
    return value && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
