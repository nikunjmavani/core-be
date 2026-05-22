import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import {
  processWebhookDeliveryAttempt,
  type WebhookDeliveryFetch,
} from '@/domains/notify/sub-domains/webhook/workers/webhook-delivery.worker.js';

const { deliveryContextFixture } = vi.hoisted(() => ({
  deliveryContextFixture: {
    deliveryAttemptId: 42,
    webhookId: 1,
    webhookUrl: 'https://example.com/hook',
    encryptedSecret: 'v1:secret',
    eventType: 'webhook.test',
    payload: { ok: true },
    attemptCount: 0,
  },
}));

vi.mock('@/domains/notify/sub-domains/webhook/webhook-delivery.repository.js', () => ({
  createWorkerWebhookDeliveryQueries: vi.fn(() => ({
    findWebhookDeliveryAttemptWithWebhook: vi.fn().mockResolvedValue(deliveryContextFixture),
  })),
  findWebhookDeliveryAttemptWithWebhook: vi.fn().mockResolvedValue(deliveryContextFixture),
}));

vi.mock('@/shared/utils/security/field-secret-encryption.util.js', () => ({
  decryptFieldSecret: vi.fn(() => 'signing-secret'),
}));

vi.mock('@/shared/utils/security/webhook-url.util.js', () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
}));

/**
 * processWebhookDeliveryAttempt() wraps its body in `withOrganizationContext` (real
 * `database.transaction()` setting `app.current_organization_id`). Run the callback
 * directly so the test exercises worker logic without needing a Postgres connection.
 */
vi.mock('@/infrastructure/database/contexts/tenant-context.js', () => ({
  withOrganizationContext: vi.fn(
    (_organizationPublicId: string, callback: (databaseHandle: unknown) => Promise<unknown>) =>
      callback({}),
  ),
}));

function createDeliveryAttemptRepositoryMock() {
  return {
    tryMarkSending: vi.fn().mockResolvedValue('claimed'),
    recordOutcome: vi.fn().mockResolvedValue(undefined),
  };
}

describe('processWebhookDeliveryAttempt', () => {
  let fetchMock: Mock<WebhookDeliveryFetch>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    }) as Mock<WebhookDeliveryFetch>;
  });

  it('forwards X-Request-Id on outbound webhook delivery', async () => {
    const repository = createDeliveryAttemptRepositoryMock();

    await processWebhookDeliveryAttempt(
      42,
      'org_public_1',
      { id: 'job-1', attemptsMade: 0, requestId: 'req-outbound-webhook' },
      fetchMock,
      repository as never,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.headers).toMatchObject({ 'X-Request-Id': 'req-outbound-webhook' });
  });

  it('invokes repository.tryMarkSending then recordOutcome(SENT) on 2xx response', async () => {
    const repository = createDeliveryAttemptRepositoryMock();

    const result = await processWebhookDeliveryAttempt(
      42,
      'org_public_1',
      { id: 'job-success', attemptsMade: 0 },
      fetchMock,
      repository as never,
    );

    expect(result).toEqual({ httpStatus: 200, success: true });
    expect(repository.tryMarkSending).toHaveBeenCalledExactlyOnceWith(42, 1);
    expect(repository.recordOutcome).toHaveBeenCalledExactlyOnceWith(42, {
      status: 'SENT',
      http_status_code: 200,
      response_body: 'ok',
    });
    expect(repository.tryMarkSending.mock.invocationCallOrder[0]!).toBeLessThan(
      repository.recordOutcome.mock.invocationCallOrder[0]!,
    );
  });

  it('invokes repository.recordOutcome(FAILED) with HTTP error and rethrows on non-2xx', async () => {
    const repository = createDeliveryAttemptRepositoryMock();
    fetchMock = vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      text: vi.fn().mockResolvedValue('server error'),
    }) as Mock<WebhookDeliveryFetch>;

    await expect(
      processWebhookDeliveryAttempt(
        77,
        'org_public_1',
        { id: 'job-fail', attemptsMade: 1 },
        fetchMock,
        repository as never,
      ),
    ).rejects.toThrow(/HTTP 500/);

    expect(repository.tryMarkSending).toHaveBeenCalledExactlyOnceWith(77, 2);
    expect(repository.recordOutcome).toHaveBeenCalledTimes(2);
    const httpFailureCall = repository.recordOutcome.mock.calls[0]![1] as {
      status: string;
      http_status_code: number;
    };
    expect(httpFailureCall).toMatchObject({ status: 'FAILED', http_status_code: 500 });
    const rethrowCall = repository.recordOutcome.mock.calls[1]![1] as {
      status: string;
      next_retry_at: Date | null;
    };
    expect(rethrowCall.status).toBe('FAILED');
    expect(rethrowCall.next_retry_at).toBeInstanceOf(Date);
  });

  it('schedules no retry on the final attempt (attemptsMade >= 4)', async () => {
    const repository = createDeliveryAttemptRepositoryMock();
    fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('network unavailable')) as Mock<WebhookDeliveryFetch>;

    await expect(
      processWebhookDeliveryAttempt(
        91,
        'org_public_1',
        { id: 'job-final', attemptsMade: 4 },
        fetchMock,
        repository as never,
      ),
    ).rejects.toThrow(/network unavailable/);

    expect(repository.tryMarkSending).toHaveBeenCalledExactlyOnceWith(91, 5);
    expect(repository.recordOutcome).toHaveBeenCalledExactlyOnceWith(91, {
      status: 'FAILED',
      response_body: 'network unavailable',
      next_retry_at: null,
    });
  });
});
