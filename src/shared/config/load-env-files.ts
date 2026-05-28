/**
 * Loads environment variables from the project root before any module reads `process.env`.
 *
 * Convention: a single file named `.env.<NODE_ENV>` per environment. Defaults to
 * `.env.development` when `NODE_ENV` is unset (local dev). The file is gitignored —
 * `.env.example` (committed) is the canonical template; `pnpm github:sync` creates
 * missing `.env.<environment>` files from `.github/sync.config.json` and pushes values.
 *
 * Local override: `.env.local` (gitignored, machine-specific) is loaded LAST with
 * `override: true` when `NODE_ENV` is not `production`. This lets a developer point
 * `DATABASE_URL` / `REDIS_URL` at their local Docker Compose stack (`pnpm compose:up`)
 * without editing `.env.<NODE_ENV>` (which `pnpm github:sync` keeps aligned with the
 * hosted environment). Use `.env.example` as the schema reference for variable names.
 * The override intentionally NEVER applies to `production` — running prod with local
 * values must always fail loudly.
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

const SAFE_KEY = /^[A-Z][A-Z0-9_]*$/;

function applyDotenvFile(envFilePath: string, override = false): void {
  const result = config({ path: envFilePath, override });
  const parsed: DotenvParseOutput = result.parsed ?? {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!SAFE_KEY.test(key)) continue;
    if (value === '') {
      // eslint-disable-next-line security/detect-object-injection -- key validated against /^[A-Z][A-Z0-9_]*$/ above
      delete process.env[key];
    }
  }
}

function loadEnvFiles(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const primary = resolve(projectRoot, `.env.${nodeEnv}`);
  let primaryApplied = false;
  if (existsSync(primary)) {
    applyDotenvFile(primary);
    primaryApplied = true;
  } else if (nodeEnv !== 'production') {
    const fallback = resolve(projectRoot, '.env.development');
    if (existsSync(fallback)) {
      applyDotenvFile(fallback);
      primaryApplied = true;
    }
  }

  if (nodeEnv === 'production' || !primaryApplied) return;

  const localOverride = resolve(projectRoot, '.env.local');
  if (existsSync(localOverride)) {
    applyDotenvFile(localOverride, true);
  }
}

loadEnvFiles();
