/**
 * Applies pending SQL migrations to a target database without recording them in
 * `public.schema_migrations` — intended for manual validation against a disposable
 * database or schema snapshot.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm db:migrate:dry-run
 *   DATABASE_MIGRATION_URL=postgresql://... pnpm db:migrate:dry-run
 */
import '@/shared/config/load-env-files.js';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  logger.error('DATABASE_URL or DATABASE_MIGRATION_URL is required');
  process.exit(1);
}

logger.info(
  { usesMigrationUrl: Boolean(process.env.DATABASE_MIGRATION_URL) },
  'db.migrate.dry_run.start',
);

const migrateScriptPath = resolve(
  process.cwd(),
  'src/infrastructure/database/migration/migrate.ts',
);

try {
  execSync(`tsx ${migrateScriptPath} --dry-run`, {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: migrationUrl,
      DATABASE_MIGRATION_URL: migrationUrl,
    },
  });
  logger.info('db.migrate.dry_run.completed');
} catch (error) {
  logger.error({ error }, 'db.migrate.dry_run.failed');
  process.exit(1);
}
