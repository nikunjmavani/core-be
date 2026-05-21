/**
 * Loads environment variables from the project root before any module reads `process.env`.
 *
 * Order: `.env` first, then `.env.local` (if present) with override so local secrets win.
 * See `.env.example` and `.env.local.example` in the repository root.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();

function loadEnvFiles(): void {
  const environmentFilePath = resolve(projectRoot, '.env');
  const localOverrideFilePath = resolve(projectRoot, '.env.local');

  config({ path: environmentFilePath });
  if (existsSync(localOverrideFilePath)) {
    config({ path: localOverrideFilePath, override: true });
  }
}

loadEnvFiles();
