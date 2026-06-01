/**
 * Faker generators for the member-roles bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/**
 * Picks a varied, non-empty subset of the supplied permission codes for one custom role so seeded
 * roles exercise different permission grants.
 */
export function generateBulkRolePermissionCodes(faker: Faker, allCodes: string[]): string[] {
  const maximum = Math.max(1, allCodes.length);
  const count = faker.number.int({ min: 1, max: maximum });
  return faker.helpers.arrayElements(allCodes, count);
}
