import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createUserDataExportController } from '@/domains/user/sub-domains/user-data-export/user-data-export.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { UserDataExportService } from '@/domains/user/sub-domains/user-data-export/user-data-export.service.js';
import { USER_DATA_EXPORT_STATUSES } from '@/domains/user/sub-domains/user-data-export/user-data-export.types.js';

function mockRequest(overrides: Partial<FastifyRequest> = {}): never {
  return {
    auth: { userId: generatePublicId(), role: 'user' },
    params: {},
    body: {},
    headers: {},
    id: 'request-id',
    ...overrides,
  } as never;
}

function mockReply(): FastifyReply {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((body) => body),
  } as unknown as FastifyReply;
}

describe('createUserDataExportController', () => {
  it('requestExport returns 202 with export payload', async () => {
    const userPublicId = generatePublicId();
    const exportPayload = {
      export_id: generatePublicId(),
      status: USER_DATA_EXPORT_STATUSES.PENDING,
      download_url: null,
      expires_at: null,
      completed_at: null,
      failed_at: null,
      error_code: null,
      created_at: new Date().toISOString(),
    };
    const service = {
      requestExport: vi.fn().mockResolvedValue(exportPayload),
    } as unknown as UserDataExportService;
    const controller = createUserDataExportController(service);
    const reply = mockReply();

    await controller.requestExport(
      mockRequest({ auth: { userId: userPublicId, role: 'user' } }),
      reply,
    );

    expect(service.requestExport).toHaveBeenCalledWith(userPublicId, { requestId: 'request-id' });
    expect(reply.status).toHaveBeenCalledWith(202);
  });

  it('getExportStatus delegates to service', async () => {
    const userPublicId = generatePublicId();
    const exportId = generatePublicId();
    const service = {
      getExportStatus: vi.fn().mockResolvedValue({
        export_id: exportId,
        status: USER_DATA_EXPORT_STATUSES.COMPLETED,
      }),
    } as unknown as UserDataExportService;
    const controller = createUserDataExportController(service);

    const response = await controller.getExportStatus(
      mockRequest({
        auth: { userId: userPublicId, role: 'user' },
        params: { exportId },
      }),
      mockReply(),
    );

    expect(service.getExportStatus).toHaveBeenCalledWith(userPublicId, exportId);
    expect(response).toMatchObject({
      data: { export_id: exportId, status: USER_DATA_EXPORT_STATUSES.COMPLETED },
    });
  });
});
