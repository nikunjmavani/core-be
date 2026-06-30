/**
 * Cloudflare Turnstile provider for `pnpm setup:infra`.
 *
 * Reads the Turnstile keys from `.setup/.setup-credentials` (CAPTCHA_SITE_KEY / CAPTCHA_SECRET),
 * validates the secret against Cloudflare siteverify, and writes CAPTCHA_PROVIDER / CAPTCHA_SITE_KEY
 * / CAPTCHA_SECRET into each `.env.<environment>` via `toEnvironmentVariables`. A single Turnstile
 * widget can list multiple hostnames (localhost + your domain), so one Site/Secret pair is
 * env-agnostic and shared across every environment — hence it lives in `.setup-credentials`
 * (like RESEND_API_KEY) rather than per-env in the env files.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: read from `.setup/.setup-credentials`, written to `.env.<environment>` only (via
 * build-env-vars), never printed to the console; setup secret files are gitignored and unreadable
 * by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { isSecretFilled } from '@tooling/setup/common/secrets.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import type {
  EnvironmentVariables,
  InfraProviderContext,
  ProviderResult,
} from '@tooling/setup/common/types.js';
import { createValidationProvider } from '../create-validation-provider.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DASHBOARD_URL = 'https://dash.cloudflare.com/?to=/:account/turnstile';

/** Cloudflare always-pass/fail TEST secret keys begin with `1x` / `2x` / `3x`. */
function isTestSecret(secret: string): boolean {
  return /^[123]x/.test(secret);
}

/**
 * Validate a Turnstile secret against Cloudflare siteverify. A dummy response token is always
 * rejected (success:false), but the `error-codes` distinguish a bad secret (`invalid-input-secret`)
 * from a merely invalid token (`invalid-input-response`) — only the former is wrong. Test secrets
 * (1x/2x/3x) are accepted without a network call.
 */
async function validateSecret(secretKey: string): Promise<boolean> {
  if (isTestSecret(secretKey)) {
    logger.success('  Turnstile — test secret key (skipping live validation)');
    return true;
  }
  try {
    const response = await setupFetch({
      name: 'Turnstile',
      url: SITEVERIFY_URL,
      init: {
        method: 'POST',
        body: new URLSearchParams({ secret: secretKey, response: 'setup-probe-token' }),
      },
    });
    const result = (await response.json()) as { 'error-codes'?: string[] };
    if (result['error-codes']?.includes('invalid-input-secret')) {
      logger.error('  Turnstile — secret rejected by Cloudflare (invalid-input-secret)');
      return false;
    }
    logger.success('  Turnstile — secret accepted by Cloudflare');
    return true;
  } catch {
    logger.warn('  Turnstile — siteverify unreachable (offline?)');
    return true;
  }
}

async function validateTurnstile(context: InfraProviderContext): Promise<ProviderResult> {
  const secretKey = context.secrets.turnstile.secretKey ?? '';
  if (!secretKey) {
    return {
      success: true,
      message: 'Turnstile: skipped (no CAPTCHA_SECRET in .setup-credentials)',
    };
  }
  // Guard: a single shared key set is written to every environment, so never let an always-pass
  // TEST key reach production. Real keys must be used when a production environment exists.
  if (context.environments.includes('production') && isTestSecret(secretKey)) {
    return {
      success: false,
      message:
        'Turnstile: test keys cannot be used for production — set real CAPTCHA_SECRET in .setup/.setup-credentials',
    };
  }
  logger.info('Validating Cloudflare Turnstile secret...');
  const valid = await validateSecret(secretKey);
  return {
    success: valid,
    message: valid ? 'Turnstile: secret validated' : 'Turnstile: secret invalid',
  };
}

export const setupCloudflareTurnstileProvider = createValidationProvider({
  key: 'turnstile',
  name: 'Cloudflare Turnstile',
  isEnabled: ({ config, secrets }) =>
    config.providers.turnstile.enabled && isSecretFilled(secrets.turnstile.secretKey),
  disabledReason: ({ config }) =>
    !config.providers.turnstile.enabled
      ? 'disabled in setup.config.json'
      : 'CAPTCHA_SECRET missing in .setup/.setup-credentials',
  preview: {
    detail: 'Site + Secret key',
    url: DASHBOARD_URL,
    configKey: 'turnstile.siteKey / turnstile.secretKey (.setup-credentials)',
  },
  settingsDetail: 'validate CAPTCHA_SECRET + write CAPTCHA_* to each env',
  instructions: [
    'A Turnstile widget is created by hand in the Cloudflare dashboard (opens automatically):',
    `  ${DASHBOARD_URL}`,
    'Add your hostname(s) — localhost for dev, your domain for prod (one widget can list both).',
    'Pick a widget mode (Managed / Non-Interactive / Invisible — Invisible matches core-fe).',
    'Copy the Site Key (public) and Secret Key (server-side) into .setup/.setup-credentials:',
    '  CAPTCHA_SITE_KEY=0x...   CAPTCHA_SECRET=0x...',
    'setup:infra validates the secret and writes CAPTCHA_PROVIDER/SITE_KEY/SECRET into each .env.<environment>.',
  ],
  describe: ({ environments }) => ({ environments }),
  toEnvironmentVariables: ({ config, secrets }, environmentName): Partial<EnvironmentVariables> => {
    const { siteKey, secretKey } = secrets.turnstile;
    if (!(config.providers.turnstile.enabled && secretKey)) return {};
    // Never bake an always-pass test key into a production env file.
    if (environmentName === 'production' && isTestSecret(secretKey)) return {};
    const variables: Partial<EnvironmentVariables> = {
      CAPTCHA_PROVIDER: 'turnstile',
      CAPTCHA_SECRET: secretKey,
    };
    if (siteKey) variables.CAPTCHA_SITE_KEY = siteKey;
    return variables;
  },
  validate: validateTurnstile,
});
