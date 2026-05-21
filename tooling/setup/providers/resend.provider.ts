import * as logger from '../logger.util.js';
import type { SetupSecrets, ProviderResult } from '../types.js';

export async function provision(secrets: SetupSecrets): Promise<ProviderResult> {
  const apiKey = secrets.resend.apiKey;

  if (!apiKey) {
    return { success: true, message: 'Resend: skipped (no API key)' };
  }

  const spinner = logger.startSpinner('Validating Resend API key...');

  try {
    const response = await fetch('https://api.resend.com/api-keys', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Resend API returned ${response.status}`);
    }

    logger.stopSpinner(spinner, 'Resend API key — valid');
    return { success: true, message: 'Resend: API key validated' };
  } catch (validationError) {
    const message =
      validationError instanceof Error ? validationError.message : String(validationError);
    logger.stopSpinner(spinner, `Resend validation failed: ${message}`, 'fail');
    return { success: false, message };
  }
}
