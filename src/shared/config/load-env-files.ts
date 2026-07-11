/**
 * Loads environment variables from the project root before any module reads `process.env`.
 *
 * This loader is the ONE place that reads `NODE_ENV` outside `env-schema.ts`: it runs before the
 * schema is parsed and its whole job is to load `.env.<NODE_ENV>` by name. It never branches runtime
 * behaviour on `NODE_ENV` — behaviour is driven by explicit env flags validated in the schema.
 *
 * Convention: a single file named `.env.<NODE_ENV>` per environment. The enum is
 * `local | development | production`; `NODE_ENV` defaults to `development` when unset (matching the
 * env schema default), so `.env.development` is the primary file for a stock `pnpm dev`. `local` is
 * the developer's machine: `NODE_ENV=local` makes `.env.local` the PRIMARY file (a self-contained
 * config with no `.env.development` inheritance). The files are gitignored — `.env.example`
 * (committed) is the canonical template; `pnpm setup:local` scaffolds a self-contained `.env.local`,
 * and `pnpm github:sync` creates missing `.env.<environment>` files (the two DEPLOY targets,
 * `development` / `production`) from `tooling/setup/setup.config.json` and pushes values.
 *
 * `.env.local` (gitignored, machine-specific) plays TWO roles, both handled by the single loader
 * below: (1) the PRIMARY file when `NODE_ENV=local`, and (2) a per-machine OVERRIDE layered on top of
 * `.env.development` / `.env.production` with `override: true` (the `!== primary` check below collapses
 * these — when `NODE_ENV=local` the override step is skipped because primary already IS `.env.local`).
 * A developer can point `DATABASE_URL` / `REDIS_URL` at their local Docker Compose stack
 * (`pnpm compose:up`) via either role. It is gitignored AND excluded from the Docker image
 * (`.dockerignore`), and production config is platform-injected (never a file) — so `.env.local`
 * is physically absent in production; the loader needs no `NODE_ENV` guard to keep it out.
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
  // Read NODE_ENV ONLY to name the primary file (`.env.<NODE_ENV>`) — no comparison, no branch.
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const primary = resolve(projectRoot, `.env.${nodeEnv}`);
  if (existsSync(primary)) {
    applyDotenvFile(primary);
  }

  // `.env.local` is a machine-local override layered on top of the primary (`override: true`). When
  // `NODE_ENV=local` it IS the primary, so the `!== primary` check skips this step (no double-load) —
  // `.env.local` then stands alone. It is gitignored AND excluded from the Docker image
  // (`.dockerignore`: `.env.*`), and production config is platform-injected (never a file) — so
  // `.env.local` is physically absent in production and this never runs there. No NODE_ENV guard needed.
  const localOverride = resolve(projectRoot, '.env.local');
  if (localOverride !== primary && existsSync(localOverride)) {
    applyDotenvFile(localOverride, true);
  }
}

loadEnvFiles();
