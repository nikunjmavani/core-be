import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Inputs for {@link capListWithWarning}. */
export interface CapListWithWarningOptions<Row> {
  rows: Row[];
  limit: number;
  resource: string;
  context?: Record<string, unknown>;
}

/**
 * Caps a list fetched with `limit + 1` back to `limit`, logging a warning when
 * the extra row proves the result was truncated.
 *
 * @remarks
 * - **Algorithm:** if `rows.length > limit`, emit a `list.capped` warning and return
 *   the first `limit` rows; otherwise return the rows unchanged.
 * - **Failure modes:** none — pure aside from the warning log.
 * - **Side effects:** structured warning log when truncation occurs.
 * - **Notes:** callers must query `limit + 1` for the overflow signal to be reliable;
 *   this turns a previously silent `LIMIT n` truncation into an observable event.
 */
export function capListWithWarning<Row>(options: CapListWithWarningOptions<Row>): Row[] {
  const { rows, limit, resource, context } = options;
  if (rows.length > limit) {
    logger.warn({ resource, limit, ...context }, 'list.capped');
    return rows.slice(0, limit);
  }
  return rows;
}
