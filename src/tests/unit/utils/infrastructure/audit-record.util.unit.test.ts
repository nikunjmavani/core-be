import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '@/domains/audit/audit.service.js';
import type { AuditLogRecordInput } from '@/domains/audit/audit.types.js';
import { recordAuditEvent } from '@/shared/utils/infrastructure/audit-record.util.js';

/**
 * `recordAuditEvent` encodes one invariant: a failed audit write must never fail the request that
 * triggered it. It is eighteen lines with a single try/catch and nothing pinned it — so nothing
 * stopped a future edit from letting the rejection escape and turning every audited mutation into
 * a 500 whenever the audit table or its RLS context misbehaves.
 */
describe('audit-record.util', () => {
  const record = vi.fn();
  const warn = vi.fn();

  const auditService = { record } as unknown as AuditService;
  const log = { warn } as unknown as FastifyBaseLogger;

  const input: AuditLogRecordInput = {
    actorUserPublicId: 'user_abcdefghijklmnopqrstu',
    action: 'organization.updated',
    resource_type: 'organization',
    organization_public_id: 'org_abcdefghijklmnopqrstu',
    severity: 'info',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('happy path', () => {
    it('delegates to the audit service exactly once with the input verbatim', async () => {
      record.mockResolvedValue(undefined);

      await recordAuditEvent(auditService, input, log);

      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(input);
    });

    it('logs nothing when the write succeeds', async () => {
      record.mockResolvedValue(undefined);

      await recordAuditEvent(auditService, input, log);

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('failure is swallowed', () => {
    it('resolves rather than rejecting when the audit write rejects', async () => {
      record.mockRejectedValue(new Error('audit insert violated RLS'));

      await expect(recordAuditEvent(auditService, input, log)).resolves.toBeUndefined();
    });

    it('resolves when the audit service throws synchronously', async () => {
      record.mockImplementation(() => {
        throw new Error('service not wired');
      });

      await expect(recordAuditEvent(auditService, input, log)).resolves.toBeUndefined();
    });

    it('warns with the error and the action so the drop is traceable', async () => {
      const error = new Error('audit insert violated RLS');
      record.mockRejectedValue(error);

      await recordAuditEvent(auditService, input, log);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        { error, action: 'organization.updated' },
        'audit.record.failed',
      );
    });

    it('swallows a non-Error rejection too', async () => {
      record.mockRejectedValue('connection terminated');

      await expect(recordAuditEvent(auditService, input, log)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        { error: 'connection terminated', action: 'organization.updated' },
        'audit.record.failed',
      );
    });
  });
});
