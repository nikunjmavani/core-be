import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { and, asc, eq, gt, gte, isNotNull, lt } from 'drizzle-orm';
import { logs } from '@/domains/audit/audit.schema.js';
import { headObject, putObjectBuffer } from '@/infrastructure/storage/storage.service.js';
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

export function buildExportKey(organizationId: number, dateLabel: string, partId: string): string {
  return `${exportPrefix()}/organization_id=${organizationId}/dt=${dateLabel}/part-${partId}.jsonl.gz`;
}

export function buildManifestKey(organizationId: number, dateLabel: string): string {
  return `${exportPrefix()}/organization_id=${organizationId}/dt=${dateLabel}/${AUDIT_EXPORT_MANIFEST_FILENAME}`;
}

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

    const partId = randomUUID();
    const objectKey = buildExportKey(organizationId, dateLabel, partId);
    const batchSize = env.AUDIT_EXPORT_BATCH_SIZE;
    let afterId = 0;
    const lines: string[] = [];

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

      for (const row of rows) {
        lines.push(`${JSON.stringify(row)}\n`);
        afterId = row.id;
      }

      if (rows.length < batchSize) break;
    }

    if (lines.length === 0) {
      skipped += 1;
      continue;
    }

    const body = gzipSync(Buffer.from(lines.join(''), 'utf8'));
    const sha256 = createHash('sha256').update(body).digest('hex');

    await putObjectBuffer({
      key: objectKey,
      body,
      contentType: 'application/gzip',
      metadata: {
        format: 'ndjson',
        schema_version: AUDIT_EXPORT_SCHEMA_VERSION,
        export_date: dateLabel,
        row_count: String(lines.length),
        sha256,
      },
    });

    const manifest: AuditExportManifest = {
      schema_version: AUDIT_EXPORT_SCHEMA_VERSION,
      export_date: dateLabel,
      organization_id: organizationId,
      objects: [
        {
          key: objectKey,
          row_count: lines.length,
          sha256,
          format: 'ndjson',
          content_type: 'application/gzip',
        },
      ],
    };

    await putObjectBuffer({
      key: manifestKey,
      body: Buffer.from(JSON.stringify(manifest), 'utf8'),
      contentType: 'application/json',
    });

    exportedOrganizations += 1;
    logger.info(
      { organizationId, objectKey, manifestKey, rowCount: lines.length, sha256 },
      'audit-export.organization.completed',
    );
  }

  logger.info({ exportedOrganizations, skipped, dateLabel }, 'audit-export.completed');
  return { exportedOrganizations, skipped };
}
