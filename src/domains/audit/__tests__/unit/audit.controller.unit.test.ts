import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createAuditController } from '@/domains/audit/audit.controller.js';
import type { ListAuditLogsQuery } from '@/domains/audit/audit.dto.js';
import type { AuditService } from '@/domains/audit/audit.service.js';

function mockReply(): FastifyReply {
  const headers = new Map<string, string>();
  return {
    header(name: string, value: string) {
      headers.set(name, value);
      return this;
    },
    getHeader(name: string) {
      return headers.get(name);
    },
  } as unknown as FastifyReply;
}

function mockRequest(
  overrides: Partial<FastifyRequest<{ Querystring: ListAuditLogsQuery }>> = {},
): FastifyRequest<{ Querystring: ListAuditLogsQuery }> {
  return {
    query: { page: 1, limit: 20 },
    id: 'request-id',
    ...overrides,
  } as FastifyRequest<{ Querystring: ListAuditLogsQuery }>;
}

function auditLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    actor_user_id: 10,
    target_user_id: null,
    organization_id: 20,
    action: 'user.login',
    resource_type: 'user',
    resource_id: 10,
    ip_address: '127.0.0.1',
    user_agent: 'vitest',
    severity: 'INFO',
    metadata: { source: 'test', auth_method_id: 99 },
    created_at: new Date('2026-05-19T12:00:00.000Z'),
    ...overrides,
  };
}

describe('createAuditController', () => {
  const service = {
    list: vi.fn().mockResolvedValue({
      items: [auditLogRow()],
      total: 1,
      limit: 20,
      total_pages: 1,
      has_more: false,
      next_cursor: null,
    }),
  } as unknown as AuditService;

  const controller = createAuditController(service);

  it('listLogs returns paginated audit entries with sanitized metadata', async () => {
    const response = await controller.listLogs(
      mockRequest({ query: { page: 1, limit: 20, include_total: 'true' } }),
      mockReply(),
    );
    expect(service.list).toHaveBeenCalled();
    expect(response).toMatchObject({
      data: [
        expect.objectContaining({
          id: 1,
          action: 'user.login',
          metadata: { source: 'test' },
        }),
      ],
    });
  });

  it('listLogs sets has_more and next when more pages exist', async () => {
    vi.mocked(service.list).mockResolvedValueOnce({
      items: [auditLogRow({ id: 1 }), auditLogRow({ id: 2 })],
      total: 4,
      limit: 2,
      total_pages: 2,
      has_more: true,
      next_cursor: 'cursor_2',
    } as never);
    const response = await controller.listLogs(
      mockRequest({ query: { page: 1, limit: 2, include_total: 'true' } }),
      mockReply(),
    );
    expect(response).toMatchObject({
      meta: {
        pagination: expect.objectContaining({
          has_more: true,
          next: 'cursor_2',
        }),
      },
    });
  });

  it('listLogs clears next when on final page', async () => {
    vi.mocked(service.list).mockResolvedValueOnce({
      items: [auditLogRow()],
      total: 1,
      limit: 20,
      total_pages: 1,
      has_more: false,
      next_cursor: null,
    } as never);
    const response = await controller.listLogs(mockRequest(), mockReply());
    expect(response).toMatchObject({
      meta: { pagination: expect.objectContaining({ has_more: false, next: null }) },
    });
  });
});
