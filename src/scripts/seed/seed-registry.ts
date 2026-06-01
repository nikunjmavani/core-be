/**
 * In-memory {@link SeedRegistry} implementation for one orchestrator run. The tenancy and
 * user seeders append created parents here; downstream domains read them to attach rows.
 */
import type { SeededOrg, SeededUser, SeedRegistry } from './seed-contract.js';

/** Creates an empty registry backed by plain arrays. */
export function createSeedRegistry(): SeedRegistry {
  const organizations: SeededOrg[] = [];
  const users: SeededUser[] = [];
  return {
    organizations,
    users,
    addOrganization(organization: SeededOrg): void {
      organizations.push(organization);
    },
    addUser(user: SeededUser): void {
      users.push(user);
    },
  };
}
