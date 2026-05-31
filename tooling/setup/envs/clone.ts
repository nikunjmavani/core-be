/**
 * Clone environment configuration from one environment to another.
 *
 * Copies .env.<source> to .env.<target> with environment name replaced,
 * useful when creating a new staging/preview environment from an existing one.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as logger from '@tooling/setup/common/logger.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Clone .env.<source> to .env.<target>, replacing the environment name.
 */
export function cloneEnvFile(source: string, target: string): boolean {
  const sourcePath = resolve(PROJECT_ROOT, `.env.${source}`);
  const targetPath = resolve(PROJECT_ROOT, `.env.${target}`);

  if (!existsSync(sourcePath)) {
    logger.error(`Source .env.${source} not found at ${sourcePath}`);
    return false;
  }

  if (existsSync(targetPath)) {
    logger.warn(`Target .env.${target} already exists — skipping (won't overwrite).`);
    return false;
  }

  let content = readFileSync(sourcePath, 'utf-8');

  // Replace environment name references
  content = content.replace(
    new RegExp(`Environment: ${escapeRegex(source)}`, 'g'),
    `Environment: ${target}`,
  );
  content = content.replace(
    new RegExp(`# Environment file for "${source}"`, 'g'),
    `# Environment file for "${target}"`,
  );

  writeFileSync(targetPath, content, 'utf-8');
  logger.success(`Created .env.${target} (cloned from .env.${source})`);
  logger.info('Review the file and update environment-specific values before syncing to GitHub.');
  return true;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
