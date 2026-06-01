/**
 * Bulk seed orchestrator — the shared entry point that resolves a profile/scale config and
 * runs every domain's {@link DomainSeedModule} in dependency order (all `seedReference`,
 * then all `seedBulk`). Behind a production guard; reproducible via `SEED`.
 *
 * Usage: `pnpm db:seed:bulk` · `BULK_PROFILE=load SCALE=5 pnpm db:seed:bulk`
 */
import '@/shared/config/load-env-files.js';
import { faker } from '@faker-js/faker';
import { authSeedModule } from '@/domains/auth/seed/index.js';
import { auditSeedModule } from '@/domains/audit/seed/index.js';
import { billingSeedModule } from '@/domains/billing/seed/index.js';
import { notifySeedModule } from '@/domains/notify/seed/index.js';
import { tenancySeedModule } from '@/domains/tenancy/seed/index.js';
import { uploadSeedModule } from '@/domains/upload/seed/index.js';
import { userSeedModule } from '@/domains/user/seed/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { resolveCounts } from './bulk-config.js';
import { initFakerSeed } from './faker-data.js';
import { closeDatabase } from './helpers.js';
import { assertBulkSeedAllowed } from './production-guard.js';
import { createSeedRegistry } from './seed-registry.js';
import { type DomainSeedModule, orderModules, type SeedContext } from './seed-contract.js';

/**
 * All registered domain seed modules. Each domain's `seed/index.ts` exports one
 * `DomainSeedModule`; they are added here as the per-domain seeders land.
 */
const MODULES: DomainSeedModule[] = [
  userSeedModule,
  authSeedModule,
  tenancySeedModule,
  billingSeedModule,
  notifySeedModule,
  uploadSeedModule,
  auditSeedModule,
];

/**
 * Runs the full bulk seed: guard, resolve config, seed reference data then bulk rows in
 * dependency order.
 *
 * @remarks
 * Failure modes: throws via {@link assertBulkSeedAllowed} on a hosted DB, or propagates any
 * domain seeder error. Side effects: writes rows across every registered domain.
 */
export async function runBulkSeed(environment: NodeJS.ProcessEnv): Promise<void> {
  assertBulkSeedAllowed(environment);
  const { profile, scale, counts } = resolveCounts(environment);

  initFakerSeed();
  const context: SeedContext = { counts, faker, registry: createSeedRegistry(), logger };
  logger.info({ profile, scale, counts }, 'seed.bulk: starting');

  const ordered = orderModules(MODULES);
  for (const module of ordered) {
    if (module.seedReference) await module.seedReference(context);
  }
  for (const module of ordered) {
    logger.info({ module: module.name }, 'seed.bulk: seeding domain');
    await module.seedBulk(context);
  }

  logger.info(
    {
      organizations: context.registry.organizations.length,
      users: context.registry.users.length,
    },
    'seed.bulk: done',
  );
}

/**
 * `closeDatabase` always runs (success or failure) so the postgres.js pool drains before
 * the process exits.
 */
runBulkSeed(process.env)
  .catch((error) => {
    logger.error({ error }, 'seed.bulk: failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
