import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { SetupConfig, SetupSecrets } from './types.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');
// Setup-tooling input credentials live in the gitignored `.setup/` directory, deliberately
// kept OUT of the app's `.env.<environment>` namespace so the two are never confused. The
// committed template lives at the repo root as `.setup-credentials.example` (next to
// `.env.example`) for discoverability. (State is ephemeral/in-memory — no file lives here.)
const SETUP_DIR = resolve(PROJECT_ROOT, '.setup');
const ENV_SETUP_PATH = resolve(SETUP_DIR, '.setup-credentials');

const TOKEN_URLS: Record<string, string> = {
  NEON_API_KEY: 'https://console.neon.tech/app/settings/api-keys',
  NEON_ORG_ID: 'https://console.neon.tech/app/settings (Organization → General → Organization ID)',
  AWS_ACCESS_KEY_ID: 'https://console.aws.amazon.com/iam/home#/users',
  AWS_SECRET_ACCESS_KEY: 'https://console.aws.amazon.com/iam/home#/users',
  SENTRY_AUTH_TOKEN: 'https://sentry.io/settings/auth-tokens/new-token/',
  RESEND_API_KEY: 'https://resend.com/api-keys',
  GITHUB_TOKEN: 'https://github.com/settings/tokens',
  RAILWAY_API_TOKEN: 'https://railway.com/account/tokens',
  POSTHOG_PERSONAL_API_KEY: 'https://us.posthog.com/settings/user-api-keys',
  CAPTCHA_SITE_KEY: 'https://dash.cloudflare.com/?to=/:account/turnstile',
  CAPTCHA_SECRET: 'https://dash.cloudflare.com/?to=/:account/turnstile',
};

const SIMPLE_VARS: Array<[string, string]> = [
  ['NEON_API_KEY', TOKEN_URLS.NEON_API_KEY ?? ''],
  ['NEON_ORG_ID', TOKEN_URLS.NEON_ORG_ID ?? ''],
  ['AWS_ACCESS_KEY_ID', TOKEN_URLS.AWS_ACCESS_KEY_ID ?? ''],
  ['AWS_SECRET_ACCESS_KEY', TOKEN_URLS.AWS_SECRET_ACCESS_KEY ?? ''],
  ['SENTRY_AUTH_TOKEN', TOKEN_URLS.SENTRY_AUTH_TOKEN ?? ''],
  ['RESEND_API_KEY', TOKEN_URLS.RESEND_API_KEY ?? ''],
  ['GITHUB_TOKEN', TOKEN_URLS.GITHUB_TOKEN ?? ''],
  ['RAILWAY_API_TOKEN', TOKEN_URLS.RAILWAY_API_TOKEN ?? ''],
  // Cloudflare Turnstile — single widget (hostnames can include localhost + your domain),
  // so one Site/Secret pair here is written to every .env.<environment>.
  ['CAPTCHA_SITE_KEY', TOKEN_URLS.CAPTCHA_SITE_KEY ?? ''],
  ['CAPTCHA_SECRET', TOKEN_URLS.CAPTCHA_SECRET ?? ''],
];

// ─── Zod schemas ────────────────────────────────────────────────────────────

// NOTE: OAuth (Google + GitHub) are app-level per-environment secrets entered directly in
// `.env.<environment>`; their providers validate them by reading those env files (see
// `envs/read-env-file.ts`).
//
// Cloudflare Turnstile lives in `.setup/.setup-credentials` env-agnostically: a single widget can
// list multiple hostnames, so one Site/Secret pair (CAPTCHA_SITE_KEY / CAPTCHA_SECRET) is written
// to every `.env.<environment>`.
//
// Stripe (by project choice) is held HERE too, but PER-ENVIRONMENT, because dev needs a test key
// and prod a live key. Since `.setup-credentials` is one flat file (not per-env), the environment
// is encoded in the key name: `STRIPE_<ENV>_SECRET_KEY` / `STRIPE_<ENV>_WEBHOOK_SECRET` (e.g.
// STRIPE_DEVELOPMENT_SECRET_KEY). The provider validates them and writes STRIPE_SECRET_KEY /
// STRIPE_WEBHOOK_SECRET into each matching `.env.<environment>`.

// Per-environment Stripe key prefix in `.setup-credentials` (env baked into the key name).
function stripeEnvPrefix(environmentName: string): string {
  return `STRIPE_${environmentName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

// The `[key, url-comment]` pairs templated into `.setup-credentials` for Stripe, per environment.
// development → test-mode dashboard + sk_test_; any other environment → live dashboard + sk_live_.
function stripeSetupVars(environmentNames: string[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const environmentName of environmentNames) {
    const prefix = stripeEnvPrefix(environmentName);
    const isTest = environmentName === 'development';
    const base = `https://dashboard.stripe.com/${isTest ? 'test/' : ''}`;
    out.push([
      `${prefix}_SECRET_KEY`,
      `Stripe ${environmentName} secret key (${isTest ? 'sk_test_…' : 'sk_live_…'}): ${base}apikeys`,
    ]);
    out.push([
      `${prefix}_WEBHOOK_SECRET`,
      `Stripe ${environmentName} webhook signing secret (whsec_…): ${base}webhooks → endpoint → Signing secret`,
    ]);
  }
  return out;
}

export const setupSecretsSchema = z.object({
  neon: z.object({
    apiKey: z.string(),
    orgId: z.string().optional(),
  }),
  aws: z.object({
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
  }),
  sentry: z.object({
    authToken: z.string(),
  }),
  resend: z.object({
    apiKey: z.string(),
  }),
  railway: z.object({
    /**
     * Account / project-wide token (Bearer auth). Required at setup time when the Railway
     * provider is enabled — gives full project lifecycle (create project, list user
     * projects, mint per-environment project tokens via `projectTokenCreate`, read/write
     * variables across environments). Set via `RAILWAY_API_TOKEN` in `.setup-credentials`.
     * Stays in `.setup-credentials` only; never pushed to GitHub Environments or Railway service
     * variables. Per-environment runtime tokens are minted from this and persisted into
     * `state.railway.environmentTokens`, then written into each `.env.<env>` as
     * `RAILWAY_TOKEN`.
     */
    apiToken: z.string().optional(),
  }),
  turnstile: z.object({
    /** Cloudflare Turnstile public site key (`CAPTCHA_SITE_KEY`, e.g. `0x4AAA…`). */
    siteKey: z.string().optional(),
    /** Cloudflare Turnstile server-side secret (`CAPTCHA_SECRET`). Validated via siteverify. */
    secretKey: z.string().optional(),
  }),
  /**
   * Per-environment Stripe keys, keyed by environment name (e.g. `development`, `production`).
   * Loaded from `.setup-credentials` as `STRIPE_<ENV>_SECRET_KEY` / `STRIPE_<ENV>_WEBHOOK_SECRET`.
   * The provider emits `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` into each `.env.<environment>`.
   */
  stripe: z
    .record(z.string(), z.object({ secretKey: z.string(), webhookSecret: z.string() }))
    .optional()
    .default({}),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function getEnvSource(): Record<string, string> {
  const fromFile: Record<string, string> = {};
  if (existsSync(ENV_SETUP_PATH)) {
    try {
      const content = readFileSync(ENV_SETUP_PATH, 'utf-8');
      Object.assign(fromFile, parseEnvFile(content));
    } catch {
      // ignore read errors
    }
  }
  const merged: Record<string, string> = { ...fromFile };
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      merged[key] = value;
    }
  }
  return merged;
}

function get(source: Record<string, string>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

// ─── Load secrets from .setup-credentials ────────────────────────────────────

export function loadSecretsFromEnv(environmentNames: string[]): SetupSecrets {
  const source = getEnvSource();

  // Per-environment Stripe keys, read as STRIPE_<ENV>_SECRET_KEY / STRIPE_<ENV>_WEBHOOK_SECRET.
  const stripe: Record<string, { secretKey: string; webhookSecret: string }> = {};
  for (const environmentName of environmentNames) {
    const prefix = stripeEnvPrefix(environmentName);
    const secretKey = get(source, `${prefix}_SECRET_KEY`);
    const webhookSecret = get(source, `${prefix}_WEBHOOK_SECRET`);
    if (secretKey || webhookSecret) stripe[environmentName] = { secretKey, webhookSecret };
  }

  return {
    neon: { apiKey: get(source, 'NEON_API_KEY'), orgId: get(source, 'NEON_ORG_ID') || undefined },
    aws: {
      accessKeyId: get(source, 'AWS_ACCESS_KEY_ID'),
      secretAccessKey: get(source, 'AWS_SECRET_ACCESS_KEY'),
    },
    sentry: { authToken: get(source, 'SENTRY_AUTH_TOKEN') },
    resend: { apiKey: get(source, 'RESEND_API_KEY') },
    railway: {
      apiToken: get(source, 'RAILWAY_API_TOKEN') || undefined,
    },
    turnstile: {
      siteKey: get(source, 'CAPTCHA_SITE_KEY') || undefined,
      secretKey: get(source, 'CAPTCHA_SECRET') || undefined,
    },
    stripe,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function loadSecrets(config: SetupConfig): z.infer<typeof setupSecretsSchema> {
  const environmentNames = config.environments.map((environment) => environment.name);
  return loadSecretsFromEnv(environmentNames);
}

export function reloadSecrets(config: SetupConfig): z.infer<typeof setupSecretsSchema> {
  return loadSecrets(config);
}

export function isSecretFilled(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getSecretsPath(): string {
  return ENV_SETUP_PATH;
}

export function envSecretsPath(): string {
  return ENV_SETUP_PATH;
}

export function envSetupFileExists(): boolean {
  return existsSync(ENV_SETUP_PATH);
}

export function getEnvSetupValue(key: string): string {
  const source = getEnvSource();
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function setEnvSetupVariable(key: string, value: string): void {
  if (!existsSync(ENV_SETUP_PATH)) return;
  let content = readFileSync(ENV_SETUP_PATH, 'utf-8');
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRegex = new RegExp(`^(${escapedKey}=).*`, 'm');
  if (lineRegex.test(content)) {
    content = content.replace(lineRegex, `$1${value}`);
  } else {
    const comment = TOKEN_URLS[key as keyof typeof TOKEN_URLS] ?? key;
    content = `${content.trimEnd()}\n\n# ${comment}\n${key}=${value}\n`;
  }
  writeFileSync(ENV_SETUP_PATH, content, 'utf-8');
}

export function hasGithubToken(): boolean {
  const source = getEnvSource();
  const value = get(source, 'GITHUB_TOKEN');
  return value.length > 0;
}

export function hasAnyEnvSecret(environmentNames: string[]): boolean {
  const secrets = loadSecretsFromEnv(environmentNames);
  const filled = (value: string | undefined) =>
    typeof value === 'string' && value.trim().length > 0;
  return (
    filled(secrets.neon.apiKey) ||
    filled(secrets.aws.accessKeyId) ||
    filled(secrets.sentry.authToken) ||
    filled(secrets.resend.apiKey) ||
    filled(secrets.railway.apiToken) ||
    filled(secrets.turnstile.secretKey) ||
    Object.values(secrets.stripe).some((entry) => filled(entry.secretKey))
  );
}

export function loadEnvSetupIntoProcess(): void {
  if (!existsSync(ENV_SETUP_PATH)) return;
  try {
    const content = readFileSync(ENV_SETUP_PATH, 'utf-8');
    const parsed = parseEnvFile(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== '' && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
}

// ─── Template generation ────────────────────────────────────────────────────

export function buildEnvSetupTemplateContent(config: SetupConfig): string {
  const environmentNames = config.environments.map((environment) => environment.name);
  const lines: string[] = [
    '# Setup secrets — fill each value and run pnpm setup.',
    '# Get each key from the URL on the line above the variable.',
    '',
    '# Project / organization / environments (to change these, edit tooling/setup/setup.config.json and re-run pnpm setup --init)',
    `# Project: ${config.project.displayName} (${config.project.name})`,
    `# Organization: ${config.project.organization}`,
    `# Environments: ${environmentNames.join(', ')}`,
    '',
  ];

  for (const [key, url] of SIMPLE_VARS) {
    lines.push(`# ${url}`);
    lines.push(`${key}=`);
    lines.push('');
  }

  // Stripe is held here per environment (test keys for development, live for production).
  lines.push('# --- Stripe (per environment) ---');
  for (const [key, url] of stripeSetupVars(environmentNames)) {
    lines.push(`# ${url}`);
    lines.push(`${key}=`);
    lines.push('');
  }

  // Remaining app-level per-environment secrets are NOT templated here — the environment is the
  // `.env.<environment>` file, not a key suffix. Enter them directly in each env file:
  lines.push(
    '# Other app per-environment secrets go in .env.<environment> (NOT here — the env is the file):',
  );
  lines.push(
    '#   OAuth:     OAUTH_GOOGLE_CLIENT_ID/_CLIENT_SECRET/_REDIRECT_URI  (+ OAUTH_GITHUB_*)',
  );
  lines.push('#   Postman:   POSTMAN_API_KEY=  POSTMAN_WORKSPACE_ID=');
  lines.push('#   Scalar:    SCALAR_API_KEY=  SCALAR_NAMESPACE=  (optional SCALAR_SLUG=)');
  lines.push(
    '#   PostHog:   POSTHOG_PERSONAL_API_KEY=  (setup resolves POSTHOG_KEY + POSTHOG_HOST)',
  );
  lines.push(
    '# (See SETUP_INFRA_PREREQUISITES.md.) Providers read/validate these from .env.<environment>.',
  );
  return lines.join('\n');
}

export function writeEnvSetupTemplateIfMissing(config: SetupConfig): boolean {
  if (existsSync(ENV_SETUP_PATH)) return false;
  mkdirSync(dirname(ENV_SETUP_PATH), { recursive: true });
  writeFileSync(ENV_SETUP_PATH, buildEnvSetupTemplateContent(config), 'utf-8');
  return true;
}

export function appendMissingEnvSetupVariables(config: SetupConfig): string[] {
  if (!existsSync(ENV_SETUP_PATH)) return [];
  const content = readFileSync(ENV_SETUP_PATH, 'utf-8');
  const existingKeys = new Set(Object.keys(parseEnvFile(content)));
  const appended: string[] = [];
  const blocks: string[] = [];

  // Account-wide, env-agnostic credential keys (incl. Turnstile's single Site/Secret pair) plus
  // Stripe's per-environment keys. Remaining app per-env secrets (OAuth) live in `.env.<environment>`.
  const environmentNames = config.environments.map((environment) => environment.name);
  for (const [key, url] of [...SIMPLE_VARS, ...stripeSetupVars(environmentNames)]) {
    if (!existingKeys.has(key)) {
      blocks.push(`# ${url}\n${key}=`);
      appended.push(key);
    }
  }

  if (blocks.length === 0) return [];
  const trimmed = content.trimEnd();
  const suffix = trimmed.endsWith('\n') ? '' : '\n';
  writeFileSync(ENV_SETUP_PATH, `${trimmed + suffix}\n${blocks.join('\n\n')}\n`, 'utf-8');
  return appended;
}

export function ensureEnvSetupTemplate(config: SetupConfig): boolean {
  return writeEnvSetupTemplateIfMissing(config);
}

const ENV_SETUP_HEADER_PREFIX = '# Project / organization / environments';
const ENV_SETUP_HEADER_END = '# Environments:';

export function updateEnvSetupHeader(config: SetupConfig): boolean {
  if (!existsSync(ENV_SETUP_PATH)) return false;
  const environmentNames = config.environments.map((environment) => environment.name);
  const newHeaderLines = [
    `${ENV_SETUP_HEADER_PREFIX} (to change these, edit tooling/setup/setup.config.json and re-run pnpm setup --init)`,
    `# Project: ${config.project.displayName} (${config.project.name})`,
    `# Organization: ${config.project.organization}`,
    `# Environments: ${environmentNames.join(', ')}`,
    '',
  ];

  let content = readFileSync(ENV_SETUP_PATH, 'utf-8');
  const prefixIndex = content.indexOf(ENV_SETUP_HEADER_PREFIX);
  if (prefixIndex === -1) {
    const insertAfter = content.indexOf('\n\n');
    const insertAt = insertAfter === -1 ? content.length : insertAfter + 2;
    content = `${content.slice(0, insertAt)}\n${newHeaderLines.join('\n')}${content.slice(insertAt)}`;
  } else {
    const lineStart = content.lastIndexOf('\n', prefixIndex) + 1;
    const endMarkerIndex = content.indexOf(ENV_SETUP_HEADER_END, prefixIndex);
    const afterEnvLine =
      endMarkerIndex === -1 ? prefixIndex : content.indexOf('\n', endMarkerIndex) + 1;
    const endIndex = afterEnvLine <= 0 ? content.length : afterEnvLine;
    content = content.slice(0, lineStart) + newHeaderLines.join('\n') + content.slice(endIndex);
  }
  writeFileSync(ENV_SETUP_PATH, content, 'utf-8');
  return true;
}
