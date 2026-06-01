/**
 * Faker generators for the auth-session bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** Generated device/browser metadata for one `auth.sessions` row. */
export interface BulkSessionProfile {
  /** Client IP address (inet column). */
  ip_address: string;
  /** Client user-agent string. */
  user_agent: string;
}

/** Builds one fake session profile from the provided faker instance. */
export function generateBulkSession(faker: Faker): BulkSessionProfile {
  return {
    ip_address: faker.internet.ipv4(),
    user_agent: faker.internet.userAgent(),
  };
}
