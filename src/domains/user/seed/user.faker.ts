/**
 * Faker generators for the user bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** A generated user's display fields (email is derived deterministically by index, not here). */
export interface BulkUserProfile {
  /** First name. */
  first_name: string;
  /** Last name. */
  last_name: string;
  /** Free-text job title (onboarding profile field). */
  job_title: string;
}

/** Builds one fake user's name + job-title fields from the provided faker instance. */
export function generateBulkUser(faker: Faker): BulkUserProfile {
  return {
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    job_title: faker.person.jobTitle(),
  };
}
