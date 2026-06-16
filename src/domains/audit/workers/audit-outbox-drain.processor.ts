import { inArray, sql as drizzleSql } from 'drizzle-orm';
import { createDrainAuditOutboxRepository } from '@/domains/audit/audit-outbox.repository.js';
import type { AuditOutboxRow } from '@/domains/audit/audit-outbox.schema.js';
import { logs } from '@/domains/audit/audit.schema.js';
import { users } from '@/domains/user/user.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { api_keys } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.schema.js';
import type { RequestScopedPostgresDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { setLocalDatabaseConfig } from '@/infrastructure/database/contexts/request-database.context.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  DEFAULT_AUDIT_OUTBOX_DRAIN_BATCH_SIZE,
  DEFAULT_AUDIT_OUTBOX_DRAIN_MAX_ATTEMPTS,
} from '@/domains/audit/workers/audit-outbox-drain.constants.js';

/**
 * Summary returned by {@link runAuditOutboxDrainJob} for observability.
 *
 * @remarks
 * - **Algorithm:** counts are accumulated as the drain iterates the claimed batch;
 *   no derived totals — `drained + transientFailed + permanentlyFailed` equals the
 *   number of rows the pass claimed.
 * - **Failure modes:** the structure itself cannot fail; it is the success-path
 *   return value. Drain errors that prevent producing this object surface as
 *   thrown errors from {@link runAuditOutboxDrainJob}.
 * - **Side effects:** none.
 * - **Notes:** consumed by structured logs (`audit.outbox.drain.pass.completed`)
 *   and the worker unit tests.
 */
export interface AuditOutboxDrainResult {
  /** Rows successfully inserted into `audit.logs` this pass. */
  drained: number;
  /** Rows whose drain failed transiently and will be retried next pass. */
  transientFailed: number;
  /** Rows permanently marked FAILED this pass (attempt cap or unresolvable). */
  permanentlyFailed: number;
}

interface ResolutionMaps {
  readonly userIdsByPublicId: ReadonlyMap<string, number>;
  readonly orgIdsByPublicId: ReadonlyMap<string, number>;
  readonly apiKeyIdsByPublicId: ReadonlyMap<string, number>;
}

/**
 * Pre-resolves every distinct actor / target / org / API-key public id in the batch
 * to its internal id in 3 round trips (one per table). Done UNDER `app.global_admin = true`
 * so a single drain pass can resolve identifiers across many tenants without per-row
 * RLS context switching. Returns lookup maps consumed by the per-row insert path.
 *
 * @remarks
 * - **Algorithm:** collects unique public ids from the batch, sets `app.global_admin`
 *   in the drain transaction, then issues 3 batched `WHERE public_id IN (...)` queries.
 * - **Failure modes:** propagates query errors; the worker rolls back the whole drain
 *   batch on resolution failure so no partial rows enter `audit.logs`.
 * - **Side effects:** `SET LOCAL app.global_admin = 'true'` for the duration of the
 *   drain transaction; one SELECT per resolved table.
 */
async function buildResolutionMaps(
  databaseHandle: RequestScopedPostgresDatabase,
  batch: readonly AuditOutboxRow[],
): Promise<ResolutionMaps> {
  await setLocalDatabaseConfig(databaseHandle, 'app.global_admin', 'true');

  const userPublicIds = new Set<string>();
  const orgPublicIds = new Set<string>();
  const apiKeyPublicIds = new Set<string>();
  for (const row of batch) {
    if (row.actor_user_public_id) userPublicIds.add(row.actor_user_public_id);
    if (row.target_user_public_id) userPublicIds.add(row.target_user_public_id);
    if (row.organization_public_id) orgPublicIds.add(row.organization_public_id);
    if (row.actor_api_key_public_id) apiKeyPublicIds.add(row.actor_api_key_public_id);
  }

  const userIdsByPublicId = await collectIdMapByPublicId(userPublicIds, async (ids) =>
    databaseHandle
      .select({ id: users.id, public_id: users.public_id })
      .from(users)
      .where(inArray(users.public_id, ids)),
  );
  const orgIdsByPublicId = await collectIdMapByPublicId(orgPublicIds, async (ids) =>
    databaseHandle
      .select({ id: organizations.id, public_id: organizations.public_id })
      .from(organizations)
      .where(inArray(organizations.public_id, ids)),
  );
  const apiKeyIdsByPublicId = await collectIdMapByPublicId(apiKeyPublicIds, async (ids) =>
    databaseHandle
      .select({ id: api_keys.id, public_id: api_keys.public_id })
      .from(api_keys)
      .where(inArray(api_keys.public_id, ids)),
  );

  return { userIdsByPublicId, orgIdsByPublicId, apiKeyIdsByPublicId };
}

/**
 * Resolves a set of public ids to their internal ids via `fetchRows`, returning an empty
 * map without a round trip when the input set is empty.
 */
async function collectIdMapByPublicId(
  publicIds: ReadonlySet<string>,
  fetchRows: (ids: string[]) => Promise<{ id: number; public_id: string }[]>,
): Promise<Map<string, number>> {
  const idByPublicId = new Map<string, number>();
  if (publicIds.size === 0) return idByPublicId;
  for (const row of await fetchRows([...publicIds])) {
    idByPublicId.set(row.public_id, row.id);
  }
  return idByPublicId;
}

interface ResolvedAuditLogInsertRow {
  actor_user_id: number | null;
  actor_api_key_id: number | null;
  target_user_id: number | null;
  organization_id: number | null;
  action: string;
  resource_type: string;
  resource_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  severity: string;
  metadata: Record<string, unknown>;
}

function resolveRowInserts(
  row: AuditOutboxRow,
  maps: ResolutionMaps,
): { row: ResolvedAuditLogInsertRow } | { error: string } {
  const actor_user_id = row.actor_user_public_id
    ? (maps.userIdsByPublicId.get(row.actor_user_public_id) ?? null)
    : null;
  const actor_api_key_id = row.actor_api_key_public_id
    ? (maps.apiKeyIdsByPublicId.get(row.actor_api_key_public_id) ?? null)
    : null;
  const target_user_id = row.target_user_public_id
    ? (maps.userIdsByPublicId.get(row.target_user_public_id) ?? null)
    : null;
  const organization_id = row.organization_public_id
    ? (maps.orgIdsByPublicId.get(row.organization_public_id) ?? null)
    : null;

  if (actor_user_id === null && actor_api_key_id === null) {
    return {
      error: 'actor public_id did not resolve (user/api-key may have been hard-deleted)',
    };
  }
  if (row.organization_public_id !== null && organization_id === null) {
    return {
      error: `organization_public_id ${row.organization_public_id} did not resolve`,
    };
  }

  return {
    row: {
      actor_user_id,
      actor_api_key_id,
      target_user_id,
      organization_id,
      action: row.action,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      severity: row.severity,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    },
  };
}

/**
 * Drains a batch of PENDING `audit.outbox` rows into `audit.logs`.
 *
 * @remarks
 * Runs inside the drain transaction opened by {@link withAuditOutboxDrainDatabaseContext}.
 * The job:
 *  1. Claims up to `batchSize` rows via FOR UPDATE SKIP LOCKED (concurrent drain instances
 *     never double-process — bumps `attempt_count` atomically on claim).
 *  2. Bulk-resolves every distinct public id with `app.global_admin = true`.
 *  3. Per row, switches `app.current_organization_id` (or `app.system_audit_insert` for
 *     tenantless rows) so the `audit.logs` INSERT passes the tenant-isolation policy.
 *  4. Marks success rows PROCESSED, retryable failures' `last_error` updated (status
 *     stays PENDING), unresolvable / over-cap rows FAILED.
 *
 * Failure modes: any thrown error rolls back the WHOLE drain batch (rows stay PENDING,
 * audit.logs writes do not commit) so the next pass re-attempts cleanly.
 *
 * Side effects: writes into `audit.logs`, updates `audit.outbox`, sets transaction-local
 * GUCs. Structured logs at every transition.
 */
export async function runAuditOutboxDrainJob(
  databaseHandle: RequestScopedPostgresDatabase,
): Promise<AuditOutboxDrainResult> {
  const batchSize = env.AUDIT_OUTBOX_DRAIN_BATCH_SIZE ?? DEFAULT_AUDIT_OUTBOX_DRAIN_BATCH_SIZE;
  const maxAttempts =
    env.AUDIT_OUTBOX_DRAIN_MAX_ATTEMPTS ?? DEFAULT_AUDIT_OUTBOX_DRAIN_MAX_ATTEMPTS;

  const drainRepository = createDrainAuditOutboxRepository(databaseHandle);
  const batch = await drainRepository.claimPendingBatch(batchSize);
  if (batch.length === 0) {
    return { drained: 0, transientFailed: 0, permanentlyFailed: 0 };
  }

  const maps = await buildResolutionMaps(databaseHandle, batch);

  const successIds: number[] = [];
  let transientFailed = 0;
  let permanentlyFailed = 0;

  for (const row of batch) {
    const result = await processAuditOutboxDrainRow({
      databaseHandle,
      drainRepository,
      row,
      maps,
      maxAttempts,
    });
    if (result.outcome === 'drained') {
      successIds.push(result.successId);
    } else if (result.outcome === 'transient') {
      transientFailed += 1;
    } else {
      permanentlyFailed += 1;
    }
  }

  await drainRepository.markProcessed(successIds);

  logger.info(
    {
      claimed: batch.length,
      drained: successIds.length,
      transientFailed,
      permanentlyFailed,
    },
    'audit.outbox.drain.pass.completed',
  );

  return {
    drained: successIds.length,
    transientFailed,
    permanentlyFailed,
  };
}

/** Outcome of draining a single `audit.outbox` row. */
type AuditOutboxDrainRowOutcome =
  | { outcome: 'drained'; successId: number }
  | { outcome: 'transient' }
  | { outcome: 'permanent' };

/**
 * Drains one claimed `audit.outbox` row into `audit.logs`: resolves its public ids, sets the
 * per-row tenant GUC, inserts, and classifies the result. Repository bookkeeping and structured
 * failure logging happen here so {@link runAuditOutboxDrainJob} only tallies outcomes.
 */
async function processAuditOutboxDrainRow(options: {
  databaseHandle: RequestScopedPostgresDatabase;
  drainRepository: ReturnType<typeof createDrainAuditOutboxRepository>;
  row: AuditOutboxRow;
  maps: ResolutionMaps;
  maxAttempts: number;
}): Promise<AuditOutboxDrainRowOutcome> {
  const { databaseHandle, drainRepository, row, maps, maxAttempts } = options;

  const resolution = resolveRowInserts(row, maps);
  if ('error' in resolution) {
    await drainRepository.markPermanentlyFailed(row.id, resolution.error);
    logger.warn(
      { outboxId: row.id, error: resolution.error },
      'audit.outbox.drain.row.unresolvable',
    );
    return { outcome: 'permanent' };
  }

  try {
    if (row.organization_public_id !== null) {
      await setLocalDatabaseConfig(
        databaseHandle,
        'app.current_organization_id',
        row.organization_public_id,
      );
    } else {
      // Tenantless audit (system events). RLS requires the system arm to be true and
      // organization_id IS NULL; resolveRowInserts guarantees the latter.
      await setLocalDatabaseConfig(databaseHandle, 'app.system_audit_insert', 'true');
    }

    await databaseHandle.insert(logs).values(resolution.row);
    return { outcome: 'drained', successId: row.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (row.attempt_count + 1 >= maxAttempts) {
      await drainRepository.markPermanentlyFailed(row.id, message);
      logger.error(
        { outboxId: row.id, attemptCount: row.attempt_count + 1, error: message },
        'audit.outbox.drain.row.failed_terminally',
      );
      return { outcome: 'permanent' };
    }
    await drainRepository.recordTransientFailure(row.id, message);
    logger.warn(
      { outboxId: row.id, attemptCount: row.attempt_count + 1, error: message },
      'audit.outbox.drain.row.transient_failure',
    );
    return { outcome: 'transient' };
  }
}

/** Re-export so callers do not couple to the constants module. */
export type { RequestScopedPostgresDatabase };
/**
 * Counts PENDING rows in `audit.outbox` for tests and operator dashboards.
 *
 * @remarks
 * - **Algorithm:** single `SELECT COUNT(*)` against `audit.outbox` filtered to
 *   `status = 'PENDING'`. Bypasses Drizzle's typed query builder via
 *   `databaseHandle.execute` so the caller can pass a worker-pinned transaction
 *   handle without a typed table reference threaded through tests.
 * - **Failure modes:** propagates query errors (e.g. missing drain GUC under
 *   RLS); the caller is expected to be in a drain or admin context.
 * - **Side effects:** read-only.
 * - **Notes:** exported solely for the audit-outbox integration test that asserts
 *   the drain worker actually empties the queue. Production observability uses
 *   the structured `audit.outbox.drain.pass.completed` log fields instead.
 */
export async function countPendingAuditOutboxRows(
  databaseHandle: RequestScopedPostgresDatabase,
): Promise<number> {
  const result = await databaseHandle.execute<{ count: number }>(
    drizzleSql`SELECT COUNT(*)::int AS count FROM audit.outbox WHERE status = 'PENDING'`,
  );
  const rows = Array.isArray(result)
    ? (result as { count: number }[])
    : ((result as { rows?: { count: number }[] }).rows ?? []);
  return rows[0]?.count ?? 0;
}
