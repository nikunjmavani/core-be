/**
 * Stripe provider for `pnpm setup:infra`.
 *
 * Reads per-environment Stripe keys from `.setup/.setup-credentials`
 * (`STRIPE_<ENV>_SECRET_KEY` / `STRIPE_<ENV>_WEBHOOK_SECRET`), validates each secret key against
 * the Stripe API (test vs live mode), and emits `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
 * into the matching `.env.<environment>`. No resource is created.
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import * as logger from '@tooling/setup/common/logger.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import type { InfraProviderContext, ProviderResult } from '@tooling/setup/common/types.js';
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
  // Keys come from `.setup/.setup-credentials` (per environment), loaded into `secrets.stripe`.
  let allValid = true;
  let anyConfigured = false;
  for (const environmentName of context.environments) {
    const secretKey = context.secrets.stripe[environmentName]?.secretKey;
    if (!secretKey) {
      logger.warn(
        `  Stripe key for "${environmentName}" — not set (STRIPE_${environmentName.toUpperCase()}_SECRET_KEY in .setup-credentials)`,
      );
      continue;
    }
    anyConfigured = true;
    if (!(await validateStripeKey(secretKey, environmentName))) allValid = false;
  }

  if (!anyConfigured) {
    return {
      success: true,
      message: 'Stripe: skipped (no STRIPE_<ENV>_SECRET_KEY in .setup-credentials)',
    };
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
    detail: 'Validates per-env STRIPE keys from .setup-credentials → writes .env.<environment>',
    url: 'https://dashboard.stripe.com/apikeys',
    configKey: '.setup-credentials → STRIPE_<ENV>_SECRET_KEY / _WEBHOOK_SECRET',
  },
  settingsDetail: 'per-env keys from .setup-credentials',
  instructions: [
    'Reads STRIPE_<ENV>_SECRET_KEY / STRIPE_<ENV>_WEBHOOK_SECRET from .setup/.setup-credentials,',
    'validates each via the Stripe API, then writes STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET to each .env.<environment>.',
    'Secret key: https://dashboard.stripe.com/apikeys · Webhook secret: https://dashboard.stripe.com/webhooks',
    'development → test keys (sk_test_…, dashboard.stripe.com/test/…); production → live keys (sk_live_…).',
  ],
  describe: ({ environments }) => ({ environments }),
  toEnvironmentVariables: ({ config, secrets }, environmentName) => {
    if (!config.providers.stripe.enabled) return {};
    const entry = secrets.stripe[environmentName];
    if (!entry?.secretKey) return {};
    return {
      STRIPE_SECRET_KEY: entry.secretKey,
      ...(entry.webhookSecret ? { STRIPE_WEBHOOK_SECRET: entry.webhookSecret } : {}),
    };
  },
  validate: validateStripe,
});
