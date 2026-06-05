/**
 * Faker generators for the auth-mfa bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** Generated MFA method content for one `auth.mfa_methods` row. */
export interface BulkMfaMethodProfile {
  /** Factor type (always `TOTP` for seeded data). */
  method_type: string;
  /** Opaque encrypted secret blob placeholder. */
  encrypted_secret: string;
}

/** Builds one fake TOTP MFA-method profile from the provided faker instance. */
export function generateBulkMfaMethod(faker: Faker): BulkMfaMethodProfile {
  return {
    method_type: 'TOTP',
    encrypted_secret: faker.string.alphanumeric({ length: 48 }),
  };
}
