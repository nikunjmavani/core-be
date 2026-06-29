import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { SetupConfig, SetupSecrets } from './types.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');
// Setup-tooling input credentials live in the gitignored `.setup/` directory (alongside
// `.setup/.setup-state.json`), deliberately kept OUT of the app's `.env.<environment>`
// namespace so the two are never confused. The committed template lives at the repo root
// as `.setup-credentials.example` (next to `.env.example`) for discoverability.
const SETUP_DIR = resolve(PROJECT_ROOT, '.setup');
const SETUP_CREDENTIALS_PATH = resolve(SETUP_DIR, '.setup-credentials');
// Legacy locations are still read (with a warning) until the operator migrates:
//   1. root `.setup-credentials` (pre-`.setup/` layout)
//   2. root `.env.setup`         (pre-rename)
const LEGACY_ROOT_CREDENTIALS_PATH = resolve(PROJECT_ROOT, '.setup-credentials');
const LEGACY_ENV_SETUP_PATH = resolve(PROJECT_ROOT, '.env.setup');
function resolveCredentialsPath(): string {
  if (existsSync(SETUP_CREDENTIALS_PATH)) return SETUP_CREDENTIALS_PATH;
  if (existsSync(LEGACY_ROOT_CREDENTIALS_PATH)) return LEGACY_ROOT_CREDENTIALS_PATH;
  if (existsSync(LEGACY_ENV_SETUP_PATH)) return LEGACY_ENV_SETUP_PATH;
  // Nothing on disk yet → default to the canonical location so init writes there.
  return SETUP_CREDENTIALS_PATH;
}
const ENV_SETUP_PATH = resolveCredentialsPath();
const USING_LEGACY_CREDENTIALS_FILE = ENV_SETUP_PATH !== SETUP_CREDENTIALS_PATH;

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

const oauthEnvironmentSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string(),
});

const stripeEnvironmentSchema = z.object({
  secretKey: z.string(),
  webhookSecret: z.string(),
});

const turnstileEnvironmentSchema = z.object({
  siteKey: z.string(),
  secretKey: z.string(),
});

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
  stripe: z.record(z.string(), stripeEnvironmentSchema).optional().default({}),
  oauth: z
    .object({
      google: z.record(z.string(), oauthEnvironmentSchema).optional().default({}),
      github: z.record(z.string(), oauthEnvironmentSchema).optional().default({}),
    })
    .optional()
    .default({ google: {}, github: {} }),
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
  turnstile: z.record(z.string(), turnstileEnvironmentSchema).optional().default({}),
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

  const stripe: SetupSecrets['stripe'] = {};
  const oauthGoogle: Record<
    string,
    { clientId: string; clientSecret: string; redirectUri: string }
  > = {};
  const oauthGithub: Record<
    string,
    { clientId: string; clientSecret: string; redirectUri: string }
  > = {};
  const turnstile: SetupSecrets['turnstile'] = {};
  const posthogEnvironmentApiKeys: Record<string, string> = {};

  for (const env of environmentNames) {
    const upper = env.toUpperCase();
    const sk = get(source, `STRIPE_${upper}_SECRET_KEY`);
    const ws = get(source, `STRIPE_${upper}_WEBHOOK_SECRET`);
    if (sk || ws) stripe[env] = { secretKey: sk, webhookSecret: ws };

    const gClient = get(source, `OAUTH_GOOGLE_${upper}_CLIENT_ID`);
    const gSecret = get(source, `OAUTH_GOOGLE_${upper}_CLIENT_SECRET`);
    const gRedirect = get(source, `OAUTH_GOOGLE_${upper}_REDIRECT_URI`);
    if (gClient || gSecret || gRedirect)
      oauthGoogle[env] = { clientId: gClient, clientSecret: gSecret, redirectUri: gRedirect };

    const ghClient = get(source, `OAUTH_GITHUB_${upper}_CLIENT_ID`);
    const ghSecret = get(source, `OAUTH_GITHUB_${upper}_CLIENT_SECRET`);
    const ghRedirect = get(source, `OAUTH_GITHUB_${upper}_REDIRECT_URI`);
    if (ghClient || ghSecret || ghRedirect)
      oauthGithub[env] = { clientId: ghClient, clientSecret: ghSecret, redirectUri: ghRedirect };

    const tSite = get(source, `TURNSTILE_${upper}_SITE_KEY`);
    const tSecret = get(source, `TURNSTILE_${upper}_SECRET_KEY`);
    if (tSite || tSecret) turnstile[env] = { siteKey: tSite, secretKey: tSecret };

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
    stripe: Object.keys(stripe).length > 0 ? stripe : {},
    oauth: {
      google: oauthGoogle,
      github: oauthGithub,
    },
    posthog: {
      personalApiKey: get(source, 'POSTHOG_PERSONAL_API_KEY'),
      projectApiKey: get(source, 'POSTHOG_PROJECT_API_KEY') || undefined,
      projectId: get(source, 'POSTHOG_PROJECT_ID') || undefined,
      environmentApiKeys: posthogEnvironmentApiKeys,
    },
    turnstile: Object.keys(turnstile).length > 0 ? turnstile : {},
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
  if (USING_LEGACY_CREDENTIALS_FILE) {
    const legacyName =
      ENV_SETUP_PATH === LEGACY_ENV_SETUP_PATH ? '.env.setup' : '.setup-credentials';
    console.warn(
      `⚠ Using legacy ${legacyName} at the repo root — move it to .setup/.setup-credentials (keeps setup creds in the gitignored .setup/ dir, out of the app .env.<environment> namespace).`,
    );
  }
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

  for (const env of environmentNames) {
    const u = env.toUpperCase();
    lines.push(
      `# Stripe (${env}) — secret: https://dashboard.stripe.com/apikeys  webhook: https://dashboard.stripe.com/webhooks`,
    );
    lines.push(`STRIPE_${u}_SECRET_KEY=`);
    lines.push(`STRIPE_${u}_WEBHOOK_SECRET=`);
    lines.push('');
    lines.push(
      `# Cloudflare Turnstile / CAPTCHA (${env}) — https://dash.cloudflare.com/?to=/:account/turnstile`,
    );
    lines.push(`TURNSTILE_${u}_SITE_KEY=`);
    lines.push(`TURNSTILE_${u}_SECRET_KEY=`);
    lines.push('');
  }

  lines.push('# Optional OAuth per env:');
  lines.push('# Google: https://console.cloud.google.com/apis/credentials');
  lines.push(
    '#   OAUTH_GOOGLE_<ENV>_CLIENT_ID=  OAUTH_GOOGLE_<ENV>_CLIENT_SECRET=  OAUTH_GOOGLE_<ENV>_REDIRECT_URI=',
  );
  lines.push('# GitHub: https://github.com/settings/developers');
  lines.push(
    '#   OAUTH_GITHUB_<ENV>_CLIENT_ID=  OAUTH_GITHUB_<ENV>_CLIENT_SECRET=  OAUTH_GITHUB_<ENV>_REDIRECT_URI=',
  );
  lines.push('# PostHog per-env project-key override (optional): POSTHOG_<ENV>_PROJECT_API_KEY=');
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

  for (const [key, url] of SIMPLE_VARS) {
    if (!existingKeys.has(key)) {
      blocks.push(`# ${url}\n${key}=`);
      appended.push(key);
    }
  }

  const environmentNames = config.environments.map((environment) => environment.name);
  for (const env of environmentNames) {
    const u = env.toUpperCase();
    const secretKey = `STRIPE_${u}_SECRET_KEY`;
    const webhookSecret = `STRIPE_${u}_WEBHOOK_SECRET`;
    const needSecret = !existingKeys.has(secretKey);
    const needWebhook = !existingKeys.has(webhookSecret);
    if (needSecret || needWebhook) {
      blocks.push(
        `# Stripe (${env}) — secret: https://dashboard.stripe.com/apikeys  webhook: https://dashboard.stripe.com/webhooks\n${secretKey}=\n${webhookSecret}=`,
      );
      if (needSecret) appended.push(secretKey);
      if (needWebhook) appended.push(webhookSecret);
    }

    const turnstileSiteKey = `TURNSTILE_${u}_SITE_KEY`;
    const turnstileSecretKey = `TURNSTILE_${u}_SECRET_KEY`;
    const needTurnstileSite = !existingKeys.has(turnstileSiteKey);
    const needTurnstileSecret = !existingKeys.has(turnstileSecretKey);
    if (needTurnstileSite || needTurnstileSecret) {
      blocks.push(
        `# Cloudflare Turnstile / CAPTCHA (${env}) — https://dash.cloudflare.com/?to=/:account/turnstile\n${turnstileSiteKey}=\n${turnstileSecretKey}=`,
      );
      if (needTurnstileSite) appended.push(turnstileSiteKey);
      if (needTurnstileSecret) appended.push(turnstileSecretKey);
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
