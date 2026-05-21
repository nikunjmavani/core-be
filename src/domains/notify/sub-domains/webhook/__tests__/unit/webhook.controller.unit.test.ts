import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createWebhookController } from '@/domains/notify/sub-domains/webhook/webhook.controller.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import type { WebhookService } from '@/domains/notify/sub-domains/webhook/webhook.service.js';

function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    auth: { userId: generatePublicId(), role: 'user' },
    params: {},
    body: {},
    query: {},
    headers: {},
    id: 'request-id',
    ...overrides,
  } as FastifyRequest;
}

function mockReply(): FastifyReply {
  const reply = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe('createWebhookController', () => {
  const organizationPublicId = generatePublicId();
  const webhookPublicId = generatePublicId();
  const webhook = { public_id: webhookPublicId, url: 'https://example.com/hook' };

  const service = {
    list: vi.fn().mockResolvedValue([webhook]),
    get: vi.fn().mockResolvedValue(webhook),
    create: vi.fn().mockResolvedValue(webhook),
    update: vi.fn().mockResolvedValue(webhook),
    delete: vi.fn().mockResolvedValue(undefined),
    listDeliveryAttempts: vi.fn().mockResolvedValue([]),
    testWebhook: vi.fn().mockResolvedValue({ delivered: true }),
  } as unknown as WebhookService;

  const controller = createWebhookController(service);

  it('listWebhooks and getWebhook delegate to service', async () => {
    await controller.listWebhooks(
      mockRequest({ params: { id: organizationPublicId } }) as never,
      mockReply(),
    );
    expect(service.list).toHaveBeenCalled();

    await controller.getWebhook(
      mockRequest({ params: { id: organizationPublicId, webhookId: webhookPublicId } }) as never,
      mockReply(),
    );
    expect(service.get).toHaveBeenCalled();
  });

  it('createWebhook and updateWebhook delegate to service', async () => {
    await controller.createWebhook(
      mockRequest({
        params: { id: organizationPublicId },
        body: { url: 'https://example.com/hook', events: ['subscription.updated'] },
      }) as never,
      mockReply(),
    );
    expect(service.create).toHaveBeenCalled();

    await controller.updateWebhook(
      mockRequest({
        params: { id: organizationPublicId, webhookId: webhookPublicId },
        body: { enabled: false },
      }) as never,
      mockReply(),
    );
    expect(service.update).toHaveBeenCalled();
  });

  it('deleteWebhook returns 204', async () => {
    const reply = mockReply();
    await controller.deleteWebhook(
      mockRequest({ params: { id: organizationPublicId, webhookId: webhookPublicId } }) as never,
      reply,
    );
    expect(service.delete).toHaveBeenCalled();
    expect(reply.code).toHaveBeenCalledWith(204);
  });

  it('listDeliveryAttempts and testWebhook delegate to service', async () => {
    await controller.listDeliveryAttempts(
      mockRequest({
        params: { id: organizationPublicId, webhookId: webhookPublicId },
        query: { limit: '10' },
      }) as never,
      mockReply(),
    );
    expect(service.listDeliveryAttempts).toHaveBeenCalled();

    await controller.testWebhook(
      mockRequest({ params: { id: organizationPublicId, webhookId: webhookPublicId } }) as never,
      mockReply(),
    );
    expect(service.testWebhook).toHaveBeenCalled();
  });

  it('listDeliveryAttempts uses default limit when query is omitted', async () => {
    await controller.listDeliveryAttempts(
      mockRequest({
        params: { id: organizationPublicId, webhookId: webhookPublicId },
        query: {},
      }) as never,
      mockReply(),
    );
    expect(service.listDeliveryAttempts).toHaveBeenCalledWith(
      organizationPublicId,
      webhookPublicId,
      25,
    );
  });
});
