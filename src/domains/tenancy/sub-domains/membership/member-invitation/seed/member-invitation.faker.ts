/**
 * Faker generators for the member-invitation bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** Builds a fake invitee email address from the provided faker instance. */
export function generateBulkInviteeEmail(faker: Faker): string {
  return faker.internet.email().toLowerCase();
}
