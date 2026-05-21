import { sql } from '@/infrastructure/database/connection.js';
import { MILLISECONDS_PER_MINUTE } from '@/shared/constants/index.js';

const MIGRATION_VERSION_CACHE_TTL_MILLISECONDS = MILLISECONDS_PER_MINUTE;

let cachedMigrationVersion: { value: string | null; expiresAt: number } | null = null;

/**
 * Latest applied migration filename from `public.schema_migrations` (cached 60s).
 */
export async function getLatestMigrationVersion(): Promise<string | null> {
  const now = Date.now();
  if (cachedMigrationVersion && cachedMigrationVersion.expiresAt > now) {
    return cachedMigrationVersion.value;
  }

  const rows = await sql<{ filename: string }[]>`
    select filename from public.schema_migrations order by filename desc limit 1
  `;
  const latestFilename = rows[0]?.filename ?? null;
  cachedMigrationVersion = {
    value: latestFilename,
    expiresAt: now + MIGRATION_VERSION_CACHE_TTL_MILLISECONDS,
  };
  return latestFilename;
}

/** Test-only: clear migration version cache between tests. */
export function resetMigrationVersionCacheForTests(): void {
  cachedMigrationVersion = null;
}
