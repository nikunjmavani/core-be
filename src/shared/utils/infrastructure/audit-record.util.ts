import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '@/domains/audit/audit.service.js';
import type { AuditLogRecordInput } from '@/domains/audit/audit.types.js';

/**
 * Best-effort audit write — failures are logged and must not fail the HTTP request.
 */
export async function recordAuditEvent(
  auditService: AuditService,
  input: AuditLogRecordInput,
  log: FastifyBaseLogger,
): Promise<void> {
  try {
    await auditService.record(input);
  } catch (error) {
    log.warn({ error, action: input.action }, 'audit.record.failed');
  }
}
