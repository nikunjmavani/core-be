import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gt, gte, isNotNull, lt } from 'drizzle-orm';
import { logs } from '@/domains/audit/audit.schema.js';
import { headObject, putObjectBuffer } from '@/infrastructure/storage/storage.service.js';
import { gzipBufferAsync } from '@/shared/utils/infrastructure/gzip.util.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  AUDIT_EXPORT_MANIFEST_FILENAME,
  AUDIT_EXPORT_SCHEMA_VERSION,
  type AuditExportManifest,
} from '@/domains/audit/workers/audit-export.constants.js';

function previousUtcDayRange(referenceDate = new Date()): {
  start: Date;
  end: Date;
  dateLabel: string;
} {
  const end = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
    ),
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 1);
  const dateLabel = start.toISOString().slice(0, 10);
  return { start, end, dateLabel };
}

function exportPrefix(): string {
  return env.AUDIT_EXPORT_S3_PREFIX.replace(/\/$/, '');
}

/**
 * Builds the S3 object key for one gzipped NDJSON part file inside an audit
 * export.
 *
 * @remarks
 * Layout is `<prefix>/organization_id=<id>/dt=<YYYY-MM-DD>/part-<uuid>.jsonl.gz`,
 * which gives Hive/Athena partition pruning by `organization_id` and `dt` and
 * makes per-tenant retention deletes cheap. The trailing `partId` is a UUID so
 * a re-run after a partial failure cannot collide with the previous attempt.
 */
export function buildExportKey(organizationId: number, dateLabel: string, partId: string): string {
  return `${exportPrefix()}/organization_id=${organizationId}/dt=${dateLabel}/part-${partId}.jsonl.gz`;
}

/**
 * Builds the S3 object key for the per-tenant per-day export manifest.
 *
 * @remarks
 * The manifest is the idempotency key for this job: the processor checks the
 * manifest's existence before exporting (`headObject(manifestKey)`) and writes
 * it last, after all data parts have been uploaded successfully. A retry that
 * sees the manifest skips the tenant entirely.
 */
export function buildManifestKey(organizationId: number, dateLabel: string): string {
  return `${exportPrefix()}/organization_id=${organizationId}/dt=${dateLabel}/${AUDIT_EXPORT_MANIFEST_FILENAME}`;
}

/**
 * Exports the previous UTC day's audit log entries to S3 for every tenant that
 * produced events.
 *
 * @remarks
 * Pull-based daily job:
 *
 * 1. Computes the previous UTC day (`[D-1, D)`) — bounded by UTC midnights so
 *    the same job can run from any time zone without missing or double-counting
 *    rows.
 * 2. Discovers active tenants via `selectDistinct(organization_id)` over the
 *    window. This avoids holding a giant cursor over the full `logs` table.
 * 3. For each tenant, checks whether the manifest already exists; if so the
 *    tenant is treated as already exported (idempotent on retry).
 * 4. Streams rows in `AUDIT_EXPORT_BATCH_SIZE` chunks ordered by `id` (stable,
 *    monotonic), writes one gzipped NDJSON part (compressed off-thread via
 *    {@link gzipBufferAsync} so job-lock renewal is not starved), then the manifest.
 *    The manifest is the LAST write so a crash mid-export leaves no manifest
 *    and the next run re-tries cleanly.
 * 5. Records sha256 of the gzipped body in S3 object metadata + manifest, so
 *    consumers can verify integrity without re-downloading the part.
 *
 * Honors `AUDIT_EXPORT_ENABLED` and `S3_BUCKET`; either being unset short-
 * circuits the whole job. Tenants with zero rows in the window are skipped
 * (no empty parts, no manifest).
 */
export async function runAuditExportJob(databaseHandle: WorkerDatabaseHandle): Promise<{
  exportedOrganizations: number;
  skipped: number;
}> {
  if (!(env.AUDIT_EXPORT_ENABLED && env.S3_BUCKET)) {
    logger.info('audit-export.skipped — disabled or S3_BUCKET unset');
    return { exportedOrganizations: 0, skipped: 0 };
  }

  const { start, end, dateLabel } = previousUtcDayRange();
  logger.info(
    { start: start.toISOString(), end: end.toISOString(), dateLabel },
    'audit-export.starting',
  );

  const organizationRows = await databaseHandle
    .selectDistinct({ organization_id: logs.organization_id })
    .from(logs)
    .where(
      and(isNotNull(logs.organization_id), gte(logs.created_at, start), lt(logs.created_at, end)),
    );

  let exportedOrganizations = 0;
  let skipped = 0;

  for (const { organization_id: organizationId } of organizationRows) {
    if (organizationId === null) continue;

    const manifestKey = buildManifestKey(organizationId, dateLabel);
    const existingManifest = await headObject(manifestKey);
    if (existingManifest) {
      skipped += 1;
      continue;
    }

    const batchSize = env.AUDIT_EXPORT_BATCH_SIZE;
    let afterId = 0;
    const manifestObjects: AuditExportManifest['objects'] = [];

    while (true) {
      const rows = await databaseHandle
        .select({
          id: logs.id,
          organization_id: logs.organization_id,
          actor_user_id: logs.actor_user_id,
          action: logs.action,
          resource_type: logs.resource_type,
          resource_id: logs.resource_id,
          severity: logs.severity,
          metadata: logs.metadata,
          created_at: logs.created_at,
        })
        .from(logs)
        .where(
          and(
            eq(logs.organization_id, organizationId),
            gte(logs.created_at, start),
            lt(logs.created_at, end),
            gt(logs.id, afterId),
          ),
        )
        .orderBy(asc(logs.id))
        .limit(batchSize);

      if (rows.length === 0) break;

      const lines = rows.map((row) => `${JSON.stringify(row)}\n`);
      const body = await gzipBufferAsync(Buffer.from(lines.join(''), 'utf8'));
      const sha256 = createHash('sha256').update(body).digest('hex');
      const batchPartId = randomUUID();
      const objectKey = buildExportKey(organizationId, dateLabel, batchPartId);

      await putObjectBuffer({
        key: objectKey,
        body,
        contentType: 'application/gzip',
        metadata: {
          format: 'ndjson',
          schema_version: AUDIT_EXPORT_SCHEMA_VERSION,
          export_date: dateLabel,
          row_count: String(rows.length),
          sha256,
        },
      });

      manifestObjects.push({
        key: objectKey,
        row_count: rows.length,
        sha256,
        format: 'ndjson',
        content_type: 'application/gzip',
      });

      afterId = rows.at(-1)?.id ?? afterId;

      if (rows.length < batchSize) break;
    }

    if (manifestObjects.length === 0) {
      skipped += 1;
      continue;
    }

    const manifest: AuditExportManifest = {
      schema_version: AUDIT_EXPORT_SCHEMA_VERSION,
      export_date: dateLabel,
      organization_id: organizationId,
      objects: manifestObjects,
    };

    await putObjectBuffer({
      key: manifestKey,
      body: Buffer.from(JSON.stringify(manifest), 'utf8'),
      contentType: 'application/json',
    });

    exportedOrganizations += 1;
    const rowCount = manifestObjects.reduce((total, object) => total + object.row_count, 0);
    logger.info(
      { organizationId, manifestKey, partCount: manifestObjects.length, rowCount },
      'audit-export.organization.completed',
    );
  }

  logger.info({ exportedOrganizations, skipped, dateLabel }, 'audit-export.completed');
  return { exportedOrganizations, skipped };
}
