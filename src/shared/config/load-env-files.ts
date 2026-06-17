/**
 * Loads environment variables from the project root before any module reads `process.env`.
 *
 * Convention: a single file named `.env.<NODE_ENV>` per environment. `NODE_ENV`
 * defaults to `local` when unset (matching the env schema default), so `.env.local`
 * is the primary file for local development. The file is gitignored — `.env.example`
 * (committed) is the canonical template; `pnpm setup:local` scaffolds a self-contained
 * `.env.local`, and `pnpm github:sync` creates missing `.env.<environment>` files from
 * `tooling/setup/setup.config.json` and pushes values.
 *
 * `.env.local` (gitignored, machine-specific): with the default `NODE_ENV=local` it
 * IS the primary file. When `NODE_ENV` is set to something else (e.g. `test`,
 * `staging`), `.env.local` is instead layered on top with `override: true` so a
 * developer can point `DATABASE_URL` / `REDIS_URL` at their local Docker Compose stack
 * (`pnpm compose:up`) without editing `.env.<NODE_ENV>`. It loads once — never
 * re-applied when it was already the primary. `.env.local` NEVER loads under
 * `production` — running prod with local values must always fail loudly.
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
  const nodeEnv = process.env.NODE_ENV ?? 'local';
  const primary = resolve(projectRoot, `.env.${nodeEnv}`);
  if (existsSync(primary)) {
    applyDotenvFile(primary);
  } else if (nodeEnv !== 'production') {
    const fallback = resolve(projectRoot, '.env.development');
    if (existsSync(fallback)) {
      applyDotenvFile(fallback);
    }
  }

  if (nodeEnv === 'production') return;

  // `.env.local` is the machine-local file. With the default `NODE_ENV=local` it is
  // already the primary loaded above; for any other `NODE_ENV` it layers on top as
  // an override. Apply it here (override: true) unless it was the primary file, so
  // it is never loaded twice.
  const localOverride = resolve(projectRoot, '.env.local');
  if (localOverride !== primary && existsSync(localOverride)) {
    applyDotenvFile(localOverride, true);
  }
}

loadEnvFiles();
