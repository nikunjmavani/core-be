import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPinnedFetch, createPinnedWebhookFetchMock } = vi.hoisted(() => ({
  mockPinnedFetch: vi.fn(),
  createPinnedWebhookFetchMock: vi.fn(),
}));

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

import { NotFoundError, ValidationError } from '@/shared/errors/index.js';
import { WebhookService } from '@/domains/notify/sub-domains/webhook/webhook.service.js';
import type { OrganizationService } from '@/domains/tenancy/sub-domains/organization/organization.service.js';
import type { WebhookRepository } from '@/domains/notify/sub-domains/webhook/webhook.repository.js';
import type { WebhookDeliveryAttemptRepository } from '@/domains/notify/sub-domains/webhook/webhook-delivery-attempt.repository.js';
import type * as FieldSecretEncryptionModule from '@/shared/utils/security/field-secret-encryption.util.js';

vi.mock('@/domains/notify/sub-domains/webhook/events/webhook-delivery-emit.js', () => ({
  emitWebhookDeliveryRequested: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/utils/security/webhook-url.util.js', () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/utils/security/webhook-outbound-fetch.util.js', () => ({
  createPinnedWebhookFetch: createPinnedWebhookFetchMock,
}));

vi.mock('@/shared/utils/security/field-secret-encryption.util.js', async (importOriginal) => ({
  ...(await importOriginal<typeof FieldSecretEncryptionModule>()),
  decryptFieldSecret: vi.fn(() => 'test-signing-secret'),
}));

const organization = { id: 1, public_id: 'org_public' };
const webhook = {
  id: 2,
  public_id: 'webhook_public',
  url: 'https://example.com/hook',
  organization_id: 1,
  encrypted_secret: 'enc:secret',
  events: ['subscription.updated'],
  is_enabled: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

describe('WebhookService', () => {
  const organizationService = {
    requireOrganizationByPublicId: vi.fn().mockResolvedValue(organization),
    resolveUserInternalIdByPublicId: vi.fn().mockResolvedValue(10),
  } as unknown as OrganizationService;

  const webhookRepository = {
    listByOrganization: vi.fn().mockResolvedValue([webhook]),
    findByPublicId: vi.fn().mockResolvedValue(webhook),
    create: vi.fn().mockResolvedValue(webhook),
    update: vi.fn().mockResolvedValue(webhook),
    softDelete: vi.fn().mockResolvedValue(webhook),
    listEnabledSubscribedToEvent: vi.fn().mockResolvedValue([]),
  } as unknown as WebhookRepository;

  const deliveryAttemptRepository = {
    getWebhookId: vi.fn().mockResolvedValue(webhook.id),
    listByWebhook: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    createPending: vi.fn().mockResolvedValue(88),
  } as unknown as WebhookDeliveryAttemptRepository;

  const service = new WebhookService(
    organizationService,
    webhookRepository,
    deliveryAttemptRepository,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(webhookRepository.findByPublicId).mockResolvedValue(webhook as never);
    vi.mocked(webhookRepository.update).mockResolvedValue(webhook as never);
    vi.mocked(webhookRepository.softDelete).mockResolvedValue(webhook as never);
    createPinnedWebhookFetchMock.mockResolvedValue(mockPinnedFetch);
    mockPinnedFetch.mockReset();
  });

  it('lists, gets, creates, updates, and deletes webhooks', async () => {
    await service.list('org_public');
    await service.get('org_public', 'webhook_public');
    await service.create(
      'org_public',
      { url: 'https://example.com/hook', events: ['subscription.updated'], secret: 's' },
      'user_public',
    );
    await service.update('org_public', 'webhook_public', { is_enabled: false }, 'user_public');
    await service.delete('org_public', 'webhook_public');
    expect(webhookRepository.softDelete).toHaveBeenCalled();
  });

  it('listDeliveryAttempts resolves webhook id', async () => {
    await service.listDeliveryAttempts('org_public', 'webhook_public', 10);
    expect(deliveryAttemptRepository.listByWebhook).toHaveBeenCalled();
  });

  it('listDeliveryAttempts throws when webhook missing', async () => {
    vi.mocked(deliveryAttemptRepository.getWebhookId).mockResolvedValue(null);
    await expect(service.listDeliveryAttempts('org_public', 'missing', 10)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('testWebhook records successful delivery attempt', async () => {
    mockPinnedFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    const result = await service.testWebhook('org_public', 'webhook_public');
    expect(result.success).toBe(true);
    expect(deliveryAttemptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SENT' }),
    );
  });

  it('testWebhook uses the SSRF-pinned fetch and signs the request', async () => {
    mockPinnedFetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });

    await service.testWebhook('org_public', 'webhook_public');

    expect(createPinnedWebhookFetchMock).toHaveBeenCalledWith(webhook.url);
    expect(mockPinnedFetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = mockPinnedFetch.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers['X-Webhook-Signature']).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(headers['X-Webhook-Timestamp']).toMatch(/^\d+$/);
  });

  it('testWebhook rejects (and records nothing) when the URL is no longer SSRF-safe', async () => {
    createPinnedWebhookFetchMock.mockRejectedValue(
      new ValidationError('errors:webhookUrlNotAllowed'),
    );

    await expect(service.testWebhook('org_public', 'webhook_public')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockPinnedFetch).not.toHaveBeenCalled();
    expect(deliveryAttemptRepository.create).not.toHaveBeenCalled();
  });

  it('testWebhook caps the persisted response body even though the returned body is truncated shorter', async () => {
    const hugeBody = 'y'.repeat(5_000);
    mockPinnedFetch.mockResolvedValue({ ok: true, status: 200, text: async () => hugeBody });

    await service.testWebhook('org_public', 'webhook_public');

    const createArgument = vi.mocked(deliveryAttemptRepository.create).mock.calls[0]![0] as {
      response_body: string;
    };
    expect(createArgument.response_body).toHaveLength(2_000);
  });

  it('testWebhook records failed delivery on network error', async () => {
    mockPinnedFetch.mockRejectedValue(new Error('network error'));

    const result = await service.testWebhook('org_public', 'webhook_public');
    expect(result.success).toBe(false);
  });

  it('get throws NotFound when webhook is missing', async () => {
    vi.mocked(webhookRepository.findByPublicId).mockResolvedValue(null);
    await expect(service.get('org_public', 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('update and delete throw NotFound when webhook is missing', async () => {
    vi.mocked(webhookRepository.update).mockResolvedValue(null);
    vi.mocked(webhookRepository.softDelete).mockResolvedValue(null);
    await expect(
      service.update('org_public', 'missing', { is_enabled: false }, 'user_public'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.delete('org_public', 'missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('testWebhook throws NotFound when webhook is missing', async () => {
    vi.mocked(webhookRepository.findByPublicId).mockResolvedValue(null);
    await expect(service.testWebhook('org_public', 'missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('testWebhook treats unreadable response body as null', async () => {
    mockPinnedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('body read failed');
      },
    });
    const result = await service.testWebhook('org_public', 'webhook_public');
    expect(result.success).toBe(true);
    expect(result.response_body).toBe('[parse error]');
  });

  it('testWebhook truncates long response bodies', async () => {
    const longBody = 'x'.repeat(600);
    mockPinnedFetch.mockResolvedValue({ ok: true, status: 200, text: async () => longBody });
    const result = await service.testWebhook('org_public', 'webhook_public');
    expect(result.response_body).toContain('[truncated]');
  });

  it('requestWebhookDelivery emits delivery event with webhook payload', async () => {
    const { emitWebhookDeliveryRequested } =
      await import('@/domains/notify/sub-domains/webhook/events/webhook-delivery-emit.js');
    await service.requestWebhookDelivery({
      webhookId: 2,
      eventType: 'subscription.updated',
      payload: { id: 'inv_1' },
    });
    expect(emitWebhookDeliveryRequested).toHaveBeenCalledWith({
      webhookId: 2,
      eventType: 'subscription.updated',
      payload: { id: 'inv_1' },
    });
  });

  it('dispatchOrganizationWebhooks requests delivery for each subscribed webhook', async () => {
    vi.mocked(webhookRepository.listEnabledSubscribedToEvent).mockResolvedValue([
      { id: 2, is_enabled: true, events: ['subscription.updated'] },
      { id: 3, is_enabled: true, events: ['subscription.updated'] },
    ] as never);
    const requestWebhookDeliverySpy = vi.spyOn(service, 'requestWebhookDelivery');

    await service.dispatchOrganizationWebhooks(1, 'subscription.updated', {
      subscription_id: 'sub_1',
    });

    expect(requestWebhookDeliverySpy).toHaveBeenCalledTimes(2);
  });

  it('update encrypts secret when provided in body', async () => {
    await service.update(
      'org_public',
      'webhook_public',
      { secret: 'new-signing-secret-value' },
      'user_public',
    );
    expect(webhookRepository.update).toHaveBeenCalledWith(
      'webhook_public',
      organization.id,
      expect.objectContaining({ encrypted_secret: expect.stringMatching(/^v1:/) }),
      10,
    );
  });

  it('listDeliveryAttempts throws when webhook id is undefined', async () => {
    vi.mocked(deliveryAttemptRepository.getWebhookId).mockResolvedValue(null);
    await expect(
      service.listDeliveryAttempts('org_public', 'webhook_public', 10),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('create passes undefined created_by_user_id when user cannot be resolved', async () => {
    vi.mocked(organizationService.resolveUserInternalIdByPublicId).mockResolvedValue(null);
    await service.create(
      'org_public',
      { url: 'https://example.com/hook', events: ['subscription.updated'] },
      'unknown_user',
    );
    const createPayload = vi
      .mocked(webhookRepository.create)
      .mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>;
    expect(createPayload).not.toHaveProperty('created_by_user_id');
  });
});
