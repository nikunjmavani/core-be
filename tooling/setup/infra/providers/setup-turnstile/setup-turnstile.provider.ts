/**
 * Cloudflare Turnstile provider for `pnpm setup:infra`.
 *
 * Validates each Turnstile secret per environment against Cloudflare siteverify (no
 * resource is created). The secret is read from each `.env.<environment>` (CAPTCHA_SECRET) —
 * Turnstile is an app secret entered directly per environment, not in setup credentials.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import type { InfraProviderContext, ProviderResult } from '@tooling/setup/common/types.js';
import { readEnvFileValue } from '@tooling/setup/envs/read-env-file.js';
import { createValidationProvider } from '../create-validation-provider.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Validate a Turnstile secret against Cloudflare siteverify. A dummy response token is
 * always rejected (HTTP 200, success:false), but the `error-codes` distinguish a bad
 * secret (`invalid-input-secret`) from a merely invalid token — only the former is wrong.
 */
async function validateSecret(secretKey: string, environmentName: string): Promise<boolean> {
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
      logger.error(`  Turnstile "${environmentName}" — secret rejected by Cloudflare`);
      return false;
    }
    logger.success(`  Turnstile "${environmentName}" — secret accepted`);
    return true;
  } catch {
    logger.warn(`  Turnstile "${environmentName}" — siteverify unreachable (offline?)`);
    return true;
  }
}

async function validateTurnstile(context: InfraProviderContext): Promise<ProviderResult> {
  logger.info('Validating Cloudflare Turnstile keys...');
  let allValid = true;
  for (const environmentName of context.environments) {
    const secretKey = readEnvFileValue(environmentName, 'CAPTCHA_SECRET');
    if (secretKey) {
      allValid = (await validateSecret(secretKey, environmentName)) && allValid;
    } else {
      logger.warn(
        `  Turnstile "${environmentName}" — CAPTCHA_SECRET not set in .env.${environmentName}`,
      );
    }
  }
  return {
    success: allValid,
    message: allValid ? 'Turnstile: keys validated' : 'Turnstile: some keys invalid',
  };
}

export const setupTurnstileProvider = createValidationProvider({
  key: 'turnstile',
  name: 'Cloudflare Turnstile',
  isEnabled: ({ config }) => config.providers.turnstile.enabled,
  disabledReason: () => 'disabled in setup.config.json',
  preview: {
    detail: 'Validates CAPTCHA_SECRET from each .env.<environment>',
    url: 'https://dash.cloudflare.com/?to=/:account/turnstile',
    configKey: '.env.<environment> → CAPTCHA_SITE_KEY / CAPTCHA_SECRET',
  },
  settingsDetail: 'validate CAPTCHA_SECRET per env from .env.<environment>',
  instructions: [
    'Validates each .env.<environment> CAPTCHA_SECRET against Cloudflare siteverify.',
    'No resource is created — enter CAPTCHA_SITE_KEY / CAPTCHA_SECRET directly in .env.<environment>.',
  ],
  describe: ({ environments }) => ({ environments }),
  validate: validateTurnstile,
});
