import { sql as drizzleSql } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { TEN_SECONDS_MS } from '@/shared/constants/ttl.constants.js';

/** Options passed to {@link withTransaction} — per-transaction statement timeout and isolation level. */
export interface TransactionOptions {
  /** Transaction timeout in milliseconds. Default: 10_000 (10 seconds). */
  timeoutMs?: number;
  /** Isolation level. Default: 'read committed'. */
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
}

/**
 * Execute a callback inside a database transaction.
 *
 * Supports optional statement_timeout and isolation level.
 * The timeout is set per-transaction to prevent runaway queries.
 *
 * SET LOCAL is executed via the transaction client (not the global pool)
 * so the timeout applies only within this transaction's connection.
 */
export async function withTransaction<T>(
  callback: (transaction: unknown) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? TEN_SECONDS_MS;
  const isolationLevel = options?.isolationLevel ?? 'read committed';

  return database.transaction(
    async (transaction) => {
      await transaction.execute(
        drizzleSql`SET LOCAL statement_timeout = ${drizzleSql.raw(String(timeoutMs))}`,
      );

      return callback(transaction);
    },
    {
      isolationLevel,
    },
  );
}
