import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** Drizzle handle for a single Postgres checkout (pool, transaction, or pinned ALS session). */
export type PostgresDatabaseHandle = PostgresJsDatabase;
