/**
 * Loads environment variables from the project root before any module reads `process.env`.
 *
 * Convention: a single file named `.env.<NODE_ENV>` per environment. Defaults to
 * `.env.development` when `NODE_ENV` is unset (local dev). The file is gitignored —
 * `.env.example` (committed) is the canonical template; copy it via `pnpm env:init` and
 * push the result to GitHub Environments via `pnpm env:sync <environment>`.
 *
 * Safety-net fallback: when `.env.<NODE_ENV>` does not exist AND `NODE_ENV` is not
 * `production`, we additionally try `.env.development`. This keeps tests and ad-hoc
 * scripts working without forcing every contributor to maintain a separate `.env.test`.
 * The fallback intentionally NEVER applies to `production` — running prod with dev
 * values must always fail loudly.
 *
 * Empty values (`KEY=` in the file) are stripped from `process.env` so optional Zod
 * fields see `undefined` instead of `""` (which fails `.string().min(1).optional()`).
 */
import { config, type DotenvParseOutput } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = process.cwd();

function applyDotenvFile(envFilePath: string): void {
  const result = config({ path: envFilePath });
  const parsed: DotenvParseOutput = result.parsed ?? {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === '') {
      delete process.env[key];
    }
  }
}

function loadEnvFiles(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const primary = resolve(projectRoot, `.env.${nodeEnv}`);
  if (existsSync(primary)) {
    applyDotenvFile(primary);
    return;
  }
  if (nodeEnv === 'production') return;
  const fallback = resolve(projectRoot, '.env.development');
  if (existsSync(fallback)) {
    applyDotenvFile(fallback);
  }
}

loadEnvFiles();
