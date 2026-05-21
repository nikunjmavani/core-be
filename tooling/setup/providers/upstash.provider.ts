import type { SetupConfig, SetupSecrets, SetupState, ProviderResult } from '../types.js';

/**
 * Upstash Redis: no provisioning. User provides UPSTASH_REDIS_URL in .env.setup.
 * Deploy maps it to REDIS_URL via build-env-vars.
 */
export async function provision(
  _config: SetupConfig,
  secrets: SetupSecrets,
  _state: SetupState,
  _environments: string[],
): Promise<ProviderResult> {
  if (!secrets.upstash?.redisUrl?.trim()) {
    return {
      success: false,
      message:
        'Upstash: UPSTASH_REDIS_URL is empty. Add it to .env.setup (get URL from https://console.upstash.com/).',
    };
  }
  return {
    success: true,
    message: 'Upstash: using UPSTASH_REDIS_URL from .env.setup',
  };
}

export async function check(_state: SetupState, _secrets: SetupSecrets): Promise<boolean> {
  return true;
}

export async function destroy(_state: SetupState, _secrets: SetupSecrets): Promise<void> {
  // No resources to destroy
}

export async function destroyEnvironment(
  _environmentName: string,
  _state: SetupState,
  _secrets: SetupSecrets,
): Promise<void> {
  // No per-env resources
}
