/**
 * Seeding contract shared by the bulk orchestrator (`bulk.ts`) and every domain's
 * `seed/` directory. Each folder that owns tables exports a {@link SeedContribution};
 * parents fold their children up the tree with {@link composeContributions}, and only
 * a top-level domain exports a {@link DomainSeedModule} that the orchestrator registers.
 */
import type { Faker } from '@faker-js/faker';
import type { Logger } from 'pino';

/** Per-table row counts the orchestrator resolves from the profile + scale and hands to every seeder. */
export interface ResolvedCounts {
  /** Number of organizations to create. */
  organizations: number;
  /** Inclusive range of members to create per organization. */
  usersPerOrg: { min: number; max: number };
  /** Custom (non-Admin) roles per organization. */
  customRolesPerOrg: number;
  /** Subscriptions per organization (spread across statuses). */
  subscriptionsPerOrg: number;
  /** Organization API keys per organization. */
  apiKeysPerOrg: number;
  /** Webhook endpoints per organization. */
  webhooksPerOrg: number;
  /** Notifications per user. */
  notificationsPerUser: number;
  /** Uploads per organization (spread across states). */
  uploadsPerOrg: number;
  /** How many past months audit rows span (one partition per month when partitioned). */
  auditMonths: number;
  /** Audit rows per organization per month. */
  auditPerOrgPerMonth: number;
  /** When true, seeders also create deliberate boundary rows (soft-deleted, expired, revoked, every status). */
  edgeCases: boolean;
}

/** A created organization that downstream domains attach their rows to. */
export interface SeededOrg {
  /** Internal bigint primary key. */
  id: number;
  /** Public identifier. */
  public_id: string;
  /** Internal id of the organization owner user. */
  ownerUserId: number;
}

/** A created user that downstream domains attach their rows to. */
export interface SeededUser {
  /** Internal bigint primary key. */
  id: number;
  /** Public identifier. */
  public_id: string;
}

/** Cross-domain registry of created parent entities; owned by the orchestrator, appended to by domains. */
export interface SeedRegistry {
  /** Organizations created so far (by the tenancy seeder). */
  organizations: SeededOrg[];
  /** Users created so far (by the user seeder). */
  users: SeededUser[];
  /** Record a created organization for downstream domains. */
  addOrganization(organization: SeededOrg): void;
  /** Record a created user for downstream domains. */
  addUser(user: SeededUser): void;
}

/** Everything a domain seeder needs: resolved counts, the seeded faker, the shared registry, and a logger. */
export interface SeedContext {
  /** Resolved per-table counts for this run. */
  counts: ResolvedCounts;
  /** Faker instance pinned to `SEED` for reproducibility. */
  faker: Faker;
  /** Cross-domain registry of created parents. */
  registry: SeedRegistry;
  /** Structured logger. */
  logger: Logger;
}

/**
 * What a sub-domain or nested sub-domain `seed/` exports. Both hooks are optional so a
 * level can contribute reference data, bulk data, or both. The parent composes it.
 */
export interface SeedContribution {
  /** Seed idempotent reference data (permissions, plans). */
  seedReference?(context: SeedContext): Promise<void>;
  /** Seed scaled bulk rows for the tables this level owns. */
  seedBulk?(context: SeedContext): Promise<void>;
}

/**
 * What a top-level domain's `seed/index.ts` exports — the only unit the orchestrator
 * registers and orders. `dependsOn` lists cross-domain bulk prerequisites (the union of
 * the domain's children's needs); intra-domain ordering lives in the domain's composition.
 */
export interface DomainSeedModule extends SeedContribution {
  /** Domain name, e.g. `'tenancy'`. */
  name: string;
  /** Names of domains whose `seedBulk` must run first. */
  dependsOn?: string[];
  /** Required at the domain level (a domain always contributes bulk rows). */
  seedBulk(context: SeedContext): Promise<void>;
}

/**
 * Folds child contributions into one: the returned contribution runs every part's
 * `seedReference` (in order), then later every part's `seedBulk` (in order), skipping
 * undefined hooks. Used at every level — nested sub-domain → sub-domain → domain.
 */
export function composeContributions(...parts: SeedContribution[]): Required<SeedContribution> {
  return {
    async seedReference(context: SeedContext): Promise<void> {
      for (const part of parts) {
        if (part.seedReference) await part.seedReference(context);
      }
    },
    async seedBulk(context: SeedContext): Promise<void> {
      for (const part of parts) {
        if (part.seedBulk) await part.seedBulk(context);
      }
    },
  };
}

/**
 * Topologically orders domain modules so each runs after every domain in its `dependsOn`.
 *
 * @remarks
 * Failure modes: throws on a dependency cycle or a reference to an unknown module name.
 * Side effects: none (returns a new array).
 */
export function orderModules(modules: DomainSeedModule[]): DomainSeedModule[] {
  const byName = new Map(modules.map((module) => [module.name, module]));
  const ordered: DomainSeedModule[] = [];
  const visited = new Set<string>();
  const inProgress = new Set<string>();

  const visit = (module: DomainSeedModule): void => {
    if (visited.has(module.name)) return;
    if (inProgress.has(module.name)) {
      throw new Error(`Dependency cycle in seed modules involving "${module.name}"`);
    }
    inProgress.add(module.name);
    for (const dependencyName of module.dependsOn ?? []) {
      const dependency = byName.get(dependencyName);
      if (!dependency) {
        throw new Error(
          `Seed module "${module.name}" depends on unknown module "${dependencyName}"`,
        );
      }
      visit(dependency);
    }
    inProgress.delete(module.name);
    visited.add(module.name);
    ordered.push(module);
  };

  for (const module of modules) visit(module);
  return ordered;
}
