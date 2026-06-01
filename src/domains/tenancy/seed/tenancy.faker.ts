/**
 * Faker generators for the tenancy bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** Generates a fake organization display name (slug is derived deterministically by index). */
export function generateBulkOrganizationName(faker: Faker): string {
  return faker.company.name();
}
