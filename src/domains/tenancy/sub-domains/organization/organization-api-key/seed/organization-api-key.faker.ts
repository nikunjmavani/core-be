/**
 * Faker generators for the organization-api-key bulk seeder. Callers pass the orchestrator's
 * seeded `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** Scope codes API keys can be granted (mirrors the create flow's accepted scopes). */
const API_KEY_SCOPES = ['organization:read', 'membership:read', 'audit-log:read'] as const;

/** Builds a fake scope subset for a seeded API key from the provided faker instance. */
export function generateBulkApiKeyScopes(faker: Faker): string[] {
  return faker.helpers.arrayElements(API_KEY_SCOPES, { min: 1, max: API_KEY_SCOPES.length });
}
