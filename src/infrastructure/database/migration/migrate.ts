import '@/shared/config/load-env-files.js';
import postgres from 'postgres';
import { resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { parseMigrationExecutionMode } from '@/infrastructure/database/migration/migration-execution-mode.js';
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
const INIT_MIGRATION_FILENAME = '00000000000000_init.sql';

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

interface BaselineExistingInitialMigrationInput {
  appliedSet: Set<string>;
  sqlFiles: string[];
}

async function baselineExistingInitialMigrationIfNeeded({
  appliedSet,
  sqlFiles,
}: BaselineExistingInitialMigrationInput): Promise<void> {
  if (appliedSet.size > 0 || !sqlFiles.includes(INIT_MIGRATION_FILENAME)) {
    return;
  }

  const [row] = await sql<
    {
      audit_logs_exists: boolean;
      auth_users_exists: boolean;
      billing_plans_exists: boolean;
      notify_notifications_exists: boolean;
      tenancy_organizations_exists: boolean;
      upload_uploads_exists: boolean;
    }[]
  >`
    SELECT
      to_regclass('audit.logs') IS NOT NULL AS audit_logs_exists,
      to_regclass('auth.users') IS NOT NULL AS auth_users_exists,
      to_regclass('billing.plans') IS NOT NULL AS billing_plans_exists,
      to_regclass('notify.notifications') IS NOT NULL AS notify_notifications_exists,
      to_regclass('tenancy.organizations') IS NOT NULL AS tenancy_organizations_exists,
      to_regclass('upload.uploads') IS NOT NULL AS upload_uploads_exists
  `;

  const hasExistingInitialSchema =
    row?.audit_logs_exists === true &&
    row.auth_users_exists === true &&
    row.billing_plans_exists === true &&
    row.notify_notifications_exists === true &&
    row.tenancy_organizations_exists === true &&
    row.upload_uploads_exists === true;

  if (!hasExistingInitialSchema) {
    return;
  }

  await sql`
    INSERT INTO public.schema_migrations (filename)
    VALUES (${INIT_MIGRATION_FILENAME})
    ON CONFLICT (filename) DO NOTHING
  `;
  appliedSet.add(INIT_MIGRATION_FILENAME);
  logger.warn(
    { filename: INIT_MIGRATION_FILENAME },
    'Baseline migration metadata for existing initialized database',
  );
}

/** Minimal shape shared by the top-level `sql` tag and a `sql.begin` transaction. */
interface MigrationStatementExecutor {
  unsafe: (query: string) => PromiseLike<unknown>;
}

interface RunMigrationStatementsInput {
  filename: string;
  statements: string[];
  executor: MigrationStatementExecutor;
}

/**
 * Executes the ordered statements of one migration against the provided
 * executor (a transaction in the default lane, the connection itself in the
 * non-transactional lane), logging the offending statement on failure.
 */
async function runMigrationStatements({
  filename,
  statements,
  executor,
}: RunMigrationStatementsInput): Promise<void> {
  let statementIndex = 0;
  for (const statement of statements) {
    statementIndex += 1;
    try {
      await executor.unsafe(statement);
    } catch (statementError) {
      logger.error(
        {
          filename,
          statementIndex,
          statementHead: statement.slice(0, 200),
          error: statementError,
        },
        'Migration statement failed',
      );
      throw statementError;
    }
  }
}

/**
 * Fails the migration when any INVALID/UNREADY index exists, which is the
 * signature of a `CREATE INDEX CONCURRENTLY` that aborted mid-build. Only used
 * by the non-transactional lane (the sole place concurrent indexes are built).
 */
async function assertNoInvalidIndexes({ filename }: { filename: string }): Promise<void> {
  const invalidIndexes = await sql<{ schema_name: string; index_name: string }[]>`
    SELECT n.nspname AS schema_name, c.relname AS index_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (NOT i.indisvalid OR NOT i.indisready)
      AND n.nspname NOT IN ('pg_catalog', 'pg_toast', 'information_schema')
    ORDER BY n.nspname, c.relname
  `;

  if (invalidIndexes.length === 0) return;

  const indexNames = invalidIndexes.map((row) => `${row.schema_name}.${row.index_name}`).join(', ');
  throw new Error(
    `Non-transactional migration ${filename} left INVALID/UNREADY index(es): ${indexNames}. ` +
      'A CREATE INDEX CONCURRENTLY likely failed mid-build. Drop the invalid index ' +
      '(DROP INDEX CONCURRENTLY IF EXISTS <schema>.<name>) and re-run pnpm db:migrate.',
  );
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

  await baselineExistingInitialMigrationIfNeeded({ appliedSet, sqlFiles });

  for (const filename of sqlFiles) {
    if (appliedSet.has(filename)) continue;

    const fullPath = resolve(migrationsFolder, filename);
    const contents = await readFile(fullPath, 'utf8');

    const { transactional, headerErrors } = parseMigrationExecutionMode(contents);
    if (headerErrors.length > 0) {
      throw new Error(
        `Invalid migration-transaction header in ${filename}: ${headerErrors.join('; ')}`,
      );
    }

    logger.info({ filename, transactional }, 'Applying migration');
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

    if (transactional) {
      await sql.begin(async (transaction) => {
        await runMigrationStatements({ filename, statements, executor: transaction });
        await transaction.unsafe('insert into public.schema_migrations (filename) values ($1)', [
          filename,
        ]);
      });
      continue;
    }

    /**
     * Non-transactional lane: each statement runs in its own implicit
     * transaction (autocommit) so `CREATE INDEX CONCURRENTLY` is legal. Because
     * there is no enclosing transaction to roll back, statements must be
     * idempotent (`IF NOT EXISTS`). A concurrent index build that fails leaves
     * an INVALID index behind, so we check for that before recording success —
     * an operator must `DROP INDEX CONCURRENTLY` the invalid index and re-run.
     */
    await runMigrationStatements({ filename, statements, executor: sql });
    await assertNoInvalidIndexes({ filename });
    await sql.unsafe('insert into public.schema_migrations (filename) values ($1)', [filename]);
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
