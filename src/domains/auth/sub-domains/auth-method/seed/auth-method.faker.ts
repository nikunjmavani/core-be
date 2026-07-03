/**
 * Faker generators for the auth-method bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';
import { AUTH_METHOD_TYPE } from '@/domains/auth/sub-domains/auth-method/auth-method.constants.js';

/** Generated login credential row for `auth.auth_methods` (one per user). */
export interface BulkAuthMethodProfile {
  /** Credential type (`EMAIL_CODE` or `OAUTH`); always a passwordless login method. */
  method_type: string;
  /** OAuth provider name (only set for `OAUTH`). */
  provider: string | null;
  /** Provider-side user identifier (only set for `OAUTH`). */
  provider_user_id: string | null;
}

const OAUTH_PROVIDERS = ['google', 'github'] as const;

/** Builds one fake auth-method profile from the provided faker instance. */
export function generateBulkAuthMethod(faker: Faker): BulkAuthMethodProfile {
  const useOauth = faker.datatype.boolean();
  if (useOauth) {
    return {
      method_type: AUTH_METHOD_TYPE.OAUTH,
      provider: faker.helpers.arrayElement(OAUTH_PROVIDERS),
      provider_user_id: faker.string.numeric(21),
    };
  }
  return {
    method_type: AUTH_METHOD_TYPE.EMAIL_CODE,
    provider: null,
    provider_user_id: null,
  };
}
