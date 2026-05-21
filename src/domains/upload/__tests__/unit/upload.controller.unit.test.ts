import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createUploadController } from '@/domains/upload/upload.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { UploadService } from '@/domains/upload/upload.service.js';

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    auth: { userId: generatePublicId(), role: 'USER' },
    params: {},
    body: {},
    headers: {},
    id: 'request-id',
    ...overrides,
  } as FastifyRequest;
}

function mockReply(): FastifyReply {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    code: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe('createUploadController', () => {
  const uploadPublicId = generatePublicId();
  const uploadResult = { publicId: uploadPublicId, uploadUrl: 'https://example.com/upload' };

  const uploadService = {
    createUpload: vi.fn().mockResolvedValue(uploadResult),
    getUpload: vi.fn().mockResolvedValue({ publicId: uploadPublicId }),
    deleteUpload: vi.fn().mockResolvedValue(undefined),
  } as unknown as UploadService;

  const controller = createUploadController(uploadService);

  it('createUpload returns 201 with presigned payload', async () => {
    const reply = mockReply();
    await controller.createUpload(
      mockRequest({
        body: {
          purpose: 'avatar',
          for: 'user',
          contentType: 'image/png',
          fileName: 'avatar.png',
          fileSize: 1024,
        },
      }),
      reply,
    );
    expect(uploadService.createUpload).toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(201);
    expect(reply.send).toHaveBeenCalled();
  });

  it('getUpload returns upload detail', async () => {
    const reply = mockReply();
    await controller.getUpload(mockRequest({ params: { publicId: uploadPublicId } }), reply);
    expect(uploadService.getUpload).toHaveBeenCalledWith(uploadPublicId, expect.any(String));
    expect(reply.send).toHaveBeenCalled();
  });

  it('deleteUpload returns 204', async () => {
    const reply = mockReply();
    await controller.deleteUpload(mockRequest({ params: { publicId: uploadPublicId } }), reply);
    expect(uploadService.deleteUpload).toHaveBeenCalled();
    expect(reply.code).toHaveBeenCalledWith(204);
  });
});
