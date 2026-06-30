/**
 * Stripe provider for `pnpm setup:infra`.
 *
 * Prompts the per-environment Stripe keys from stdin (masked), validates each secret key against
 * the Stripe API (test vs live mode), and writes `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
 * into the matching `.env.<environment>`. No env-suffixed keys live in `.setup/.setup-credentials`.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: prompted from stdin, written to `.env.<environment>` only, never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import type { InfraProviderContext, ProviderResult } from '@tooling/setup/common/types.js';
import { collectEnvCredentials } from '@tooling/setup/envs/env-file-setup.util.js';
import { readEnvFileValue } from '@tooling/setup/envs/read-env-file.js';
import { createValidationProvider } from '../create-validation-provider.js';

async function validateStripeKey(secretKey: string, environmentName: string): Promise<boolean> {
  try {
    await setupFetch({
      name: 'Stripe',
      url: 'https://api.stripe.com/v1/balance',
      init: { headers: { Authorization: `Bearer ${secretKey}` } },
      expectedStatus: 200,
    });
    const keyType = secretKey.startsWith('sk_test_') ? 'test' : 'live';
    logger.success(`  Stripe key for "${environmentName}" — valid (${keyType} mode)`);
    return true;
  } catch {
    logger.error(`  Stripe key for "${environmentName}" — invalid or unreachable`);
    return false;
  }
}

async function validateStripe(context: InfraProviderContext): Promise<ProviderResult> {
  // Prompt per environment (dev = test key, prod = live key) and write into each .env.<env>.
  await collectEnvCredentials(context.config, {
    providerName: 'Stripe',
    scope: 'per-environment',
    fields: [
      {
        key: 'STRIPE_SECRET_KEY',
        label: 'Secret key (sk_test_… for development, sk_live_… for production)',
        secret: true,
      },
      {
        key: 'STRIPE_WEBHOOK_SECRET',
        label: 'Webhook signing secret (whsec_…, optional)',
        secret: true,
      },
    ],
  });

  let allValid = true;
  let anyConfigured = false;
  for (const environmentName of context.environments) {
    const secretKey = readEnvFileValue(environmentName, 'STRIPE_SECRET_KEY');
    if (!secretKey) {
      logger.warn(`  Stripe key for "${environmentName}" — not set in .env.${environmentName}`);
      continue;
    }
    anyConfigured = true;
    if (!(await validateStripeKey(secretKey, environmentName))) allValid = false;
  }

  if (!anyConfigured) {
    return { success: true, message: 'Stripe: skipped (no STRIPE_SECRET_KEY entered)' };
  }
  return {
    success: allValid,
    message: allValid ? 'Stripe: all keys validated' : 'Stripe: some keys invalid',
  };
}

export const setupStripeProvider = createValidationProvider({
  key: 'stripe',
  name: 'Stripe',
  isEnabled: ({ config }) => config.providers.stripe.enabled,
  disabledReason: () => 'disabled in setup.config.json',
  preview: {
    detail: 'Prompts STRIPE keys per env → validates → writes .env.<environment>',
    url: 'https://dashboard.stripe.com/apikeys',
    configKey: '.env.<environment> → STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET',
  },
  settingsDetail: 'prompt + validate per env',
  instructions: [
    'Prompts STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET per environment, validates via the Stripe API, writes to each .env.<environment>.',
    'development → test keys (sk_test_…); production → live keys (sk_live_…).',
    'Get them: https://dashboard.stripe.com/apikeys (webhook secret: https://dashboard.stripe.com/webhooks).',
  ],
  describe: ({ environments }) => ({ environments }),
  validate: validateStripe,
});
