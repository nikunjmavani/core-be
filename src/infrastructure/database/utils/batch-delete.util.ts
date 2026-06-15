import { and, asc, eq, gt, inArray, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import type { PostgresDatabaseHandle } from '@/infrastructure/database/utils/database-handle.types.js';
import { isPostgresForeignKeyViolation } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const DEFAULT_BATCH_SIZE = 5_000;

/**
 * Outcome of {@link deleteInBatchesByCondition}: rows actually removed plus rows
 * skipped because a foreign-key constraint blocked their per-row fallback delete.
 */
export interface BatchDeleteResult {
  deletedCount: number;
  blockedCount: number;
}

async function deleteRowsIndividually(options: {
  databaseHandle: PostgresDatabaseHandle;
  table: AnyPgTable;
  idColumn: AnyPgColumn;
  identifiers: ReadonlyArray<number | string>;
  logContext: string | undefined;
  tableLabel: string | undefined;
}): Promise<BatchDeleteResult> {
  const { databaseHandle, table, idColumn, identifiers, logContext, tableLabel } = options;
  let deletedCount = 0;
  let blockedCount = 0;
  for (const identifier of identifiers) {
    try {
      await databaseHandle.delete(table).where(eq(idColumn, identifier));
      deletedCount += 1;
    } catch (rowError) {
      if (!isPostgresForeignKeyViolation(rowError)) {
        throw rowError;
      }
      blockedCount += 1;
      logger.warn({ logContext, tableLabel, identifier }, 'batch-delete.fkBlocked');
    }
  }
  return { deletedCount, blockedCount };
}

/**
 * Deletes rows matching `whereCondition` in batches to avoid unbounded RETURNING payloads
 * and long idle-in-transaction windows on retention workers.
 * On FK violation, falls back to per-row deletes and counts blocked rows.
 *
 * Batches are keyset-paged on `idColumn` (ascending), so FK-blocked rows — which remain in the
 * table and keep matching `whereCondition` — are scanned once and then skipped, guaranteeing the
 * loop terminates after a single forward pass even when a whole batch is permanently blocked.
 *
 * Callers must pass an explicit `databaseHandle` (from `connection.ts` or a worker context wrapper).
 */
export async function deleteInBatchesByCondition(options: {
  databaseHandle: PostgresDatabaseHandle;
  table: AnyPgTable;
  idColumn: AnyPgColumn;
  whereCondition: SQL;
  batchSize?: number;
  /** Included in FK-blocked logs when per-row delete fails. */
  logContext?: string;
  tableLabel?: string;
}): Promise<BatchDeleteResult> {
  const {
    databaseHandle,
    table,
    idColumn,
    whereCondition,
    batchSize = DEFAULT_BATCH_SIZE,
    logContext,
    tableLabel,
  } = options;
  let deletedCount = 0;
  let blockedCount = 0;
  // Keyset cursor on `idColumn`. FK-blocked rows stay in the table and keep matching
  // `whereCondition`; without paging past them, a full batch (>= batchSize) of permanently-blocked
  // rows would be re-selected every iteration and the loop would never terminate. Advancing the
  // cursor past every scanned id guarantees a single forward pass.
  let cursor: number | string | undefined;

  for (;;) {
    const scanCondition =
      cursor === undefined ? whereCondition : and(whereCondition, gt(idColumn, cursor));
    const batchIds = await databaseHandle
      .select({ id: idColumn })
      .from(table)
      .where(scanCondition)
      .orderBy(asc(idColumn))
      .limit(batchSize);

    if (batchIds.length === 0) {
      break;
    }

    const identifiers = batchIds.map((row) => row.id as number | string);
    // Advance the cursor to the highest id scanned BEFORE deleting, so blocked rows (which remain)
    // are excluded from the next scan.
    cursor = identifiers[identifiers.length - 1];

    try {
      await databaseHandle.delete(table).where(inArray(idColumn, identifiers));
      deletedCount += identifiers.length;
    } catch (error) {
      if (!isPostgresForeignKeyViolation(error)) {
        throw error;
      }
      const perRow = await deleteRowsIndividually({
        databaseHandle,
        table,
        idColumn,
        identifiers,
        logContext,
        tableLabel,
      });
      deletedCount += perRow.deletedCount;
      blockedCount += perRow.blockedCount;
    }

    if (batchIds.length < batchSize) {
      break;
    }
  }

  return { deletedCount, blockedCount };
}
