/**
 * Loads environment variables from the project root before any module reads `process.env`.
 *
 * This loader is the ONE place that reads `NODE_ENV` outside `env-schema.ts`: it runs before the
 * schema is parsed and its whole job is to load `.env.<NODE_ENV>` by name. It never branches runtime
 * behaviour on `NODE_ENV` — behaviour is driven by explicit env flags validated in the schema.
 *
 * Convention: a single file named `.env.<NODE_ENV>` per environment. `NODE_ENV` defaults to
 * `development` when unset (matching the env schema default; the enum is `development | production`),
 * so `.env.development` is the primary file for local development. The file is gitignored —
 * `.env.example` (committed) is the canonical template; `pnpm setup:local` scaffolds a self-contained
 * `.env.local`, and `pnpm github:sync` creates missing `.env.<environment>` files from
 * `tooling/setup/setup.config.json` and pushes values.
 *
 * `.env.local` (gitignored, machine-specific) is a per-machine OVERRIDE filename, not a `NODE_ENV`
 * value: it is layered on top of the primary `.env.<NODE_ENV>` file with `override: true` so a
 * developer can point `DATABASE_URL` / `REDIS_URL` at their local Docker Compose stack
 * (`pnpm compose:up`) without editing `.env.<NODE_ENV>`. It is gitignored AND excluded from the Docker
 * image (`.dockerignore`), and production config is platform-injected (never a file) — so `.env.local`
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

  // `.env.local` is a machine-local override layered on top of the primary (`override: true`). It is
  // gitignored AND excluded from the Docker image (`.dockerignore`: `.env.*`), and production config is
  // platform-injected (never a file) — so `.env.local` is physically absent in production and this
  // never runs there. No NODE_ENV guard needed. The `!== primary` check avoids a double-load.
  const localOverride = resolve(projectRoot, '.env.local');
  if (localOverride !== primary && existsSync(localOverride)) {
    applyDotenvFile(localOverride, true);
  }
}

loadEnvFiles();
