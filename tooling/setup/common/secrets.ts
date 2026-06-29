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
  POSTMAN_API_KEY: 'https://go.postman.co/settings/me/api-keys',
  POSTMAN_WORKSPACE_ID: 'https://go.postman.co/workspaces',
  SCALAR_API_KEY: 'https://dashboard.scalar.com (Settings → API keys)',
  SCALAR_NAMESPACE: 'https://dashboard.scalar.com (your team namespace)',
  SCALAR_SLUG: 'https://dashboard.scalar.com (registry slug; defaults to core-be)',
  POSTHOG_PERSONAL_API_KEY:
    'https://us.posthog.com/settings/user-api-keys (Create personal API key → All access)',
  POSTHOG_PROJECT_API_KEY: 'https://us.posthog.com/settings/project (Project API Key, phc_…)',
  POSTHOG_PROJECT_ID: 'https://us.posthog.com/settings/project (Project ID)',
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
  ['POSTMAN_API_KEY', TOKEN_URLS.POSTMAN_API_KEY ?? ''],
  ['POSTMAN_WORKSPACE_ID', TOKEN_URLS.POSTMAN_WORKSPACE_ID ?? ''],
  ['SCALAR_API_KEY', TOKEN_URLS.SCALAR_API_KEY ?? ''],
  ['SCALAR_NAMESPACE', TOKEN_URLS.SCALAR_NAMESPACE ?? ''],
  ['SCALAR_SLUG', TOKEN_URLS.SCALAR_SLUG ?? ''],
  ['POSTHOG_PERSONAL_API_KEY', TOKEN_URLS.POSTHOG_PERSONAL_API_KEY ?? ''],
  ['POSTHOG_PROJECT_API_KEY', TOKEN_URLS.POSTHOG_PROJECT_API_KEY ?? ''],
  ['POSTHOG_PROJECT_ID', TOKEN_URLS.POSTHOG_PROJECT_ID ?? ''],
];

// ─── Zod schemas ────────────────────────────────────────────────────────────

// NOTE: Stripe, OAuth (Google + GitHub) and Cloudflare Turnstile are app-level per-environment
// secrets. They are NOT held in `.setup/.setup-credentials` — the environment dimension belongs
// to the `.env.<environment>` file, not a key suffix. They live directly in `.env.development` /
// `.env.production` (STRIPE_SECRET_KEY, OAUTH_*_CLIENT_ID/SECRET, CAPTCHA_SITE_KEY/SECRET) and
// their providers validate them by reading those env files (see `envs/read-env-file.ts`).

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
  posthog: z
    .object({
      /** Setup-time personal key (`phx_…`) — resolves the project key via the PostHog API. */
      personalApiKey: z.string(),
      /** Verbatim project key (`phc_…`) override — when set, the API lookup is skipped. */
      projectApiKey: z.string().optional(),
      /** Resolve the project key from this project id (GET /api/projects/<id>/). */
      projectId: z.string().optional(),
      /** Per-environment project-key overrides (mapped from `POSTHOG_<ENV>_PROJECT_API_KEY`). */
      environmentApiKeys: z.record(z.string(), z.string()).optional().default({}),
    })
    .optional()
    .default({ personalApiKey: '', environmentApiKeys: {} }),
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
  postman: z
    .object({
      apiKey: z.string(),
      workspaceId: z.string(),
    })
    .optional()
    .default({ apiKey: '', workspaceId: '' }),
  scalar: z
    .object({
      apiKey: z.string(),
      namespace: z.string(),
      slug: z.string(),
    })
    .optional()
    .default({ apiKey: '', namespace: '', slug: '' }),
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

  const posthogEnvironmentApiKeys: Record<string, string> = {};

  for (const env of environmentNames) {
    const upper = env.toUpperCase();
    // Stripe / OAuth / Turnstile are app secrets entered directly in `.env.<environment>`
    // (no env-suffixed setup-credential keys) — not read here.
    const phKey = get(source, `POSTHOG_${upper}_PROJECT_API_KEY`);
    if (phKey) posthogEnvironmentApiKeys[env] = phKey;
  }

  return {
    neon: { apiKey: get(source, 'NEON_API_KEY'), orgId: get(source, 'NEON_ORG_ID') || undefined },
    aws: {
      accessKeyId: get(source, 'AWS_ACCESS_KEY_ID'),
      secretAccessKey: get(source, 'AWS_SECRET_ACCESS_KEY'),
    },
    sentry: { authToken: get(source, 'SENTRY_AUTH_TOKEN') },
    resend: { apiKey: get(source, 'RESEND_API_KEY') },
    posthog: {
      personalApiKey: get(source, 'POSTHOG_PERSONAL_API_KEY'),
      projectApiKey: get(source, 'POSTHOG_PROJECT_API_KEY') || undefined,
      projectId: get(source, 'POSTHOG_PROJECT_ID') || undefined,
      environmentApiKeys: posthogEnvironmentApiKeys,
    },
    railway: {
      apiToken: get(source, 'RAILWAY_API_TOKEN') || undefined,
    },
    postman: {
      apiKey: get(source, 'POSTMAN_API_KEY'),
      workspaceId: get(source, 'POSTMAN_WORKSPACE_ID'),
    },
    scalar: {
      apiKey: get(source, 'SCALAR_API_KEY'),
      namespace: get(source, 'SCALAR_NAMESPACE'),
      slug: get(source, 'SCALAR_SLUG'),
    },
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
    filled(secrets.postman.apiKey) ||
    filled(secrets.scalar.apiKey)
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

  // App-level per-environment secrets are NOT templated here — the environment is the
  // `.env.<environment>` file, not a key suffix. Enter them directly in each env file:
  lines.push(
    '# App per-environment secrets go in .env.<environment> (NOT here — the env is the file):',
  );
  lines.push('#   Stripe:    STRIPE_SECRET_KEY=  STRIPE_WEBHOOK_SECRET=');
  lines.push(
    '#   OAuth:     OAUTH_GOOGLE_CLIENT_ID/_CLIENT_SECRET/_REDIRECT_URI  (+ OAUTH_GITHUB_*)',
  );
  lines.push('#   Turnstile: CAPTCHA_SITE_KEY=  CAPTCHA_SECRET=');
  lines.push(
    '# (See SETUP_INFRA_PREREQUISITES.md.) Their providers validate these from .env.<environment>.',
  );
  return lines.join('\n');
}

export function writeEnvSetupTemplateIfMissing(config: SetupConfig): boolean {
  if (existsSync(ENV_SETUP_PATH)) return false;
  mkdirSync(dirname(ENV_SETUP_PATH), { recursive: true });
  writeFileSync(ENV_SETUP_PATH, buildEnvSetupTemplateContent(config), 'utf-8');
  return true;
}

export function appendMissingEnvSetupVariables(_config: SetupConfig): string[] {
  if (!existsSync(ENV_SETUP_PATH)) return [];
  const content = readFileSync(ENV_SETUP_PATH, 'utf-8');
  const existingKeys = new Set(Object.keys(parseEnvFile(content)));
  const appended: string[] = [];
  const blocks: string[] = [];

  // Only account-wide, env-agnostic credential keys are templated. App per-environment
  // secrets (Stripe / OAuth / Turnstile) live in `.env.<environment>`, never here.
  for (const [key, url] of SIMPLE_VARS) {
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
