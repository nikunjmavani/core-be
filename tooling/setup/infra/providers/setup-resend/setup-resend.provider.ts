/**
 * Resend provider for `pnpm setup:infra`.
 *
 * Validates the Resend API key (no resource is created — Resend exposes a single org-level key).
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*`, environment names from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; setup secret files are gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import {
  resolveResendFromAddress,
  resolveResendFromName,
} from '@tooling/setup/common/resend-from.js';
import { isSecretFilled } from '@tooling/setup/common/secrets.js';
import { setupFetch } from '@tooling/setup/common/setup-fetch.js';
import type { EnvironmentVariables, ProviderResult } from '@tooling/setup/common/types.js';
import { createValidationProvider } from '../create-validation-provider.js';

async function validateResend(apiKey: string): Promise<ProviderResult> {
  if (!apiKey) return { success: true, message: 'Resend: skipped (no API key)' };
  await setupFetch({
    name: 'Resend',
    url: 'https://api.resend.com/api-keys',
    init: { headers: { Authorization: `Bearer ${apiKey}` } },
    expectedStatus: 200,
  });
  return { success: true, message: 'Resend: API key validated' };
}

export const setupResendProvider = createValidationProvider({
  key: 'resend',
  name: 'Resend',
  isEnabled: ({ config, secrets }) =>
    config.providers.resend.enabled && isSecretFilled(secrets.resend.apiKey),
  disabledReason: ({ config }) =>
    !config.providers.resend.enabled
      ? 'disabled in setup.config.json'
      : 'RESEND_API_KEY missing in .setup/.setup-credentials',
  preview: { detail: 'API key', url: 'https://resend.com/api-keys', configKey: 'resend.apiKey' },
  settingsDetail: 'validate 1 key',
  instructions: [
    'Will validate RESEND_API_KEY by calling https://api.resend.com/api-keys.',
    'No resource is created — Resend exposes a single org-level key.',
  ],
  toEnvironmentVariables: ({ config, secrets }) => {
    if (!config.providers.resend.enabled) return {};
    // EMAIL_FROM_* are plain config (derived from project identity), so emit them
    // whenever Resend is enabled — independent of whether the API key is set yet.
    const vars: Partial<EnvironmentVariables> = {
      EMAIL_FROM_ADDRESS: resolveResendFromAddress(config),
      EMAIL_FROM_NAME: resolveResendFromName(config),
    };
    // The key is a secret — only emit it once it is present in .setup-credentials.
    if (secrets.resend.apiKey) vars.RESEND_API_KEY = secrets.resend.apiKey;
    return vars;
  },
  validate: ({ secrets }) => validateResend(secrets.resend.apiKey),
});
