import '@/shared/config/load-env-files.js';
import postgres from 'postgres';
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Uses DATABASE_MIGRATION_URL if available (elevated-privilege user),
 * otherwise falls back to DATABASE_URL.
 */
const migrationUrl = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error('DATABASE_URL or DATABASE_MIGRATION_URL must be set for migrations');
}

const sql = postgres(migrationUrl, { max: 1 });

/**
 * Postgres 17+ is required project-wide (docker-compose, CI services,
 * testcontainers, and managed providers like Neon are all pinned to 17).
 * Refuse to apply migrations against older servers so test infra drift
 * (e.g. someone pointing DATABASE_MIGRATION_URL at a local 15/16 cluster)
 * is caught before it can produce a partially-applied schema.
 */
const MINIMUM_POSTGRES_SERVER_VERSION_NUM = 170000;

async function assertPostgresMajorVersionAtLeast17(): Promise<void> {
  const [row] = await sql<
    { server_version_num: string; server_version: string }[]
  >`SELECT current_setting('server_version_num') AS server_version_num, current_setting('server_version') AS server_version`;
  const serverVersionNum = Number(row?.server_version_num ?? '0');
  if (
    !Number.isFinite(serverVersionNum) ||
    serverVersionNum < MINIMUM_POSTGRES_SERVER_VERSION_NUM
  ) {
    throw new Error(
      `Refusing to run migrations against Postgres ${row?.server_version ?? 'unknown'} (server_version_num=${row?.server_version_num ?? 'unknown'}). Postgres 17+ is required project-wide. See .cursor/skills/db-migration-maintainer/SKILL.md and docker-compose.yml.`,
    );
  }
}

async function main() {
  const migrationsFolder = resolve(process.cwd(), 'migrations');
  logger.info({ migrationsFolder }, 'Running migrations');

  await assertPostgresMajorVersionAtLeast17();

  await sql`
    create table if not exists public.schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = await sql<{ filename: string }[]>`
    select filename from public.schema_migrations order by filename asc
  `;
  const appliedSet = new Set(applied.map((row) => row.filename));

  const allFiles = await readdir(migrationsFolder);
  const sqlFiles = allFiles.filter((file) => file.endsWith('.sql')).sort();

  for (const filename of sqlFiles) {
    if (appliedSet.has(filename)) continue;

    const fullPath = resolve(migrationsFolder, filename);
    const contents = await readFile(fullPath, 'utf8');

    logger.info({ filename }, 'Applying migration');
    /**
     * Drizzle-style splitter: SQL files use `--> statement-breakpoint` between
     * statements so that each statement is sent independently. This prevents
     * issues with the postgres simple-query protocol mis-reporting errors when
     * a single batch contains many statements with DO blocks, dollar-quoting,
     * and DDL that depend on prior statements in the same batch.
     */
    const statements = contents
      .split(/\n--> statement-breakpoint\s*\n?/g)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);

    await sql.begin(async (transaction) => {
      let statementIndex = 0;
      for (const statement of statements) {
        statementIndex += 1;
        try {
          await transaction.unsafe(statement);
        } catch (statementError) {
          logger.error(
            {
              statementIndex,
              statementHead: statement.slice(0, 200),
              error: statementError,
            },
            'Migration statement failed',
          );
          throw statementError;
        }
      }
      await transaction.unsafe('insert into public.schema_migrations (filename) values ($1)', [
        filename,
      ]);
    });
  }

  logger.info('Migrations complete');
}

main()
  .then(async () => {
    await sql.end({ timeout: 5_000 });
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ error }, 'Migrations failed');
    try {
      await sql.end({ timeout: 5_000 });
    } catch {
      // ignore
    }
    process.exit(1);
  });
