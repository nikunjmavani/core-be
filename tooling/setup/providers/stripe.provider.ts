import * as logger from '../logger.util.js';
import type { SetupSecrets, ProviderResult } from '../types.js';

async function validateStripeKey(secretKey: string, environmentName: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${secretKey}` },
    });

    if (!response.ok) {
      logger.error(`  Stripe key for "${environmentName}" — invalid (${response.status})`);
      return false;
    }

    const isTestKey = secretKey.startsWith('sk_test_');
    const keyType = isTestKey ? 'test' : 'live';
    logger.success(`  Stripe key for "${environmentName}" — valid (${keyType} mode)`);
    return true;
  } catch {
    logger.error(`  Stripe key for "${environmentName}" — unreachable`);
    return false;
  }
}

export async function provision(
  secrets: SetupSecrets,
  environments: string[],
): Promise<ProviderResult> {
  if (!secrets.stripe || Object.keys(secrets.stripe).length === 0) {
    return { success: true, message: 'Stripe: skipped (no keys configured)' };
  }

  const spinner = logger.startSpinner('Validating Stripe API keys...');
  logger.stopSpinner(spinner, 'Validating Stripe API keys...');

  let allValid = true;

  for (const environmentName of environments) {
    const stripeEnvironmentSecrets = secrets.stripe[environmentName];
    if (!stripeEnvironmentSecrets?.secretKey) {
      logger.warn(`  Stripe key for "${environmentName}" — not configured`);
      continue;
    }

    const valid = await validateStripeKey(stripeEnvironmentSecrets.secretKey, environmentName);
    if (!valid) allValid = false;
  }

  return {
    success: allValid,
    message: allValid ? 'Stripe: all keys validated' : 'Stripe: some keys invalid',
  };
}
