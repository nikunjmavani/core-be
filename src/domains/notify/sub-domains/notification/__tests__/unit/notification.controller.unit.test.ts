import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { NotFoundError } from '@/shared/errors/index.js';
import { createNotificationController } from '@/domains/notify/sub-domains/notification/notification.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

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

describe('createNotificationController', () => {
  const notificationId = generatePublicId();
  const notification = { public_id: notificationId };
  const service = {
    listForUser: vi.fn().mockResolvedValue({
      items: [notification],
      total: null,
      limit: 25,
      has_more: false,
      next_cursor: null,
    }),
    get: vi.fn().mockResolvedValue(notification),
    markRead: vi.fn().mockResolvedValue(notification),
    markAllRead: vi.fn().mockResolvedValue([notification]),
    getUnreadCount: vi.fn().mockResolvedValue(2),
    deleteNotification: vi.fn().mockResolvedValue(notification),
  };

  const controller = createNotificationController(service as never);

  it('listNotifications returns paginated data', async () => {
    const response = await controller.listNotifications(
      mockRequest({ query: { limit: '25' } }),
      {} as FastifyReply,
    );
    expect(service.listForUser).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ limit: 25, include_total: false }),
    );
    expect(
      (response as { meta: { pagination: { has_more: boolean; next: string | null } } }).meta
        .pagination,
    ).toMatchObject({ has_more: false, next: null });
  });

  it('listNotifications rejects limit above 100', async () => {
    await expect(
      controller.listNotifications(mockRequest({ query: { limit: '500' } }), {} as FastifyReply),
    ).rejects.toThrow();
  });

  it('getNotification returns row', async () => {
    await controller.getNotification(
      mockRequest({ params: { id: notificationId } }),
      {} as FastifyReply,
    );
    expect(service.get).toHaveBeenCalledWith(notificationId, expect.any(String));
  });

  it('markNotificationRead updates row', async () => {
    await controller.markNotificationRead(
      mockRequest({ params: { id: notificationId } }),
      {} as FastifyReply,
    );
    expect(service.markRead).toHaveBeenCalled();
  });

  it('markAllRead and getUnreadCount delegate to service', async () => {
    await controller.markAllRead(mockRequest(), {} as FastifyReply);
    await controller.getUnreadCount(mockRequest(), {} as FastifyReply);
    expect(service.markAllRead).toHaveBeenCalled();
    expect(service.getUnreadCount).toHaveBeenCalled();
  });

  it('deleteNotification returns 204', async () => {
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await controller.deleteNotification(
      mockRequest({ params: { notificationId } }),
      reply as unknown as FastifyReply,
    );
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it('getNotification throws NotFound when service returns null', async () => {
    vi.mocked(service.get).mockResolvedValueOnce(null);
    await expect(
      controller.getNotification(
        mockRequest({ params: { id: notificationId } }),
        {} as FastifyReply,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('markNotificationRead throws NotFound when service returns null', async () => {
    vi.mocked(service.markRead).mockResolvedValueOnce(null);
    await expect(
      controller.markNotificationRead(
        mockRequest({ params: { id: notificationId } }),
        {} as FastifyReply,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('deleteNotification throws NotFound when service returns null', async () => {
    vi.mocked(service.deleteNotification).mockResolvedValueOnce(null);
    await expect(
      controller.deleteNotification(mockRequest({ params: { notificationId } }), {
        code: vi.fn(),
        send: vi.fn(),
      } as unknown as FastifyReply),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
