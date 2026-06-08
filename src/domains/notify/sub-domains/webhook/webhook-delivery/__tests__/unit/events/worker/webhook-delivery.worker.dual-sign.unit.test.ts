import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
  processWebhookDeliveryAttempt,
  type WebhookDeliveryFetch,
} from '@/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-delivery.worker.js';
import { resetWebhookOutboundCircuitsForTesting } from '@/domains/notify/sub-domains/webhook/webhook-delivery/workers/webhook-outbound-circuit.js';

const { findWebhook, baseDeliveryContext } = vi.hoisted(() => {
  const baseDeliveryContext = {
    deliveryAttemptId: 42,
    // sec-new-B2: opaque public id used as the X-Webhook-Delivery-Id header value.
    deliveryAttemptPublicId: 'wa0y8vf3ktxqnhcm1ze21',
    webhookId: 1,
    webhookUrl: 'https://example.com/hook',
    encryptedSecret: 'enc:current',
    eventType: 'webhook.test',
    payload: { ok: true },
    attemptCount: 0,
    webhookIsEnabled: true,
    webhookDeletedAt: null as Date | null,
    encryptedSecretPrevious: null as string | null,
    secretRotatedAt: null as Date | null,
  };
  const findWebhook = vi.fn();
  return { findWebhook, baseDeliveryContext };
});

vi.mock(
  '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery.repository.js',
  () => ({
    createWorkerWebhookDeliveryQueries: vi.fn(() => ({
      findWebhookDeliveryAttemptWithWebhook: findWebhook,
    })),
    findWebhookDeliveryAttemptWithWebhook: findWebhook,
  }),
);

vi.mock('@/shared/utils/security/field-secret-encryption.util.js', () => ({
  // Decrypt strips the `enc:` prefix used in fixtures so we can tell which
  // signing key was used in the request.
  decryptFieldSecret: vi.fn((value: string) => value.replace(/^enc:/, '')),
}));

vi.mock('@/shared/utils/security/webhook-url.util.js', () => ({
  validateWebhookUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/database/contexts/tenant-database.context.js', () => ({
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

/**
 * Regression for sec-N8 (Low → Medium-pragmatic): webhook secret rotation
 * created a guaranteed retry-failure window because `update()` overwrote the
 * old `encrypted_secret` in place. Any in-flight (or BullMQ-retried) delivery
 * signed with the new key reached a customer still verifying with the old key.
 *
 * The worker now dual-signs whenever the parent webhook has a non-null
 * `encrypted_secret_previous` AND the current time is within the configured
 * rotation overlap window (default 24h). The dual signature is emitted via
 * `X-Webhook-Signature-Previous` so the customer can accept either while
 * rolling. After the window, the worker stops emitting the header even if the
 * column is still populated (re-rotation overwrites; no separate sweeper).
 */
describe('processWebhookDeliveryAttempt — webhook secret rotation overlap (sec-N8)', () => {
  let fetchMock: Mock<WebhookDeliveryFetch>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    }) as Mock<WebhookDeliveryFetch>;
    findWebhook.mockReset();
  });

  afterEach(() => {
    resetWebhookOutboundCircuitsForTesting();
  });

  it('omits X-Webhook-Signature-Previous when no rotation has happened (default)', async () => {
    findWebhook.mockResolvedValue({ ...baseDeliveryContext });
    const repository = createDeliveryAttemptRepositoryMock();
    await processWebhookDeliveryAttempt(
      42,
      'org_public_1',
      { id: 'job-no-rotation', attemptsMade: 0 },
      fetchMock,
      repository as never,
    );
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.headers).not.toHaveProperty('X-Webhook-Signature-Previous');
  });

  it('emits X-Webhook-Signature-Previous when within the overlap window', async () => {
    findWebhook.mockResolvedValue({
      ...baseDeliveryContext,
      encryptedSecretPrevious: 'enc:previous',
      // Rotated 1 hour ago — well inside the default 24h window.
      secretRotatedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const repository = createDeliveryAttemptRepositoryMock();
    await processWebhookDeliveryAttempt(
      42,
      'org_public_1',
      { id: 'job-rotation-in-window', attemptsMade: 0 },
      fetchMock,
      repository as never,
    );
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.headers).toHaveProperty('X-Webhook-Signature-Previous');
    const previousHeader = (requestInit.headers as Record<string, string>)[
      'X-Webhook-Signature-Previous'
    ];
    // Same format as the primary signature header: t=<ts>,v1=<hex>
    expect(previousHeader).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    // The previous signature must differ from the current one (different key).
    const currentHeader = (requestInit.headers as Record<string, string>)['X-Webhook-Signature'];
    expect(currentHeader).not.toBe(previousHeader);
  });

  it('stops emitting X-Webhook-Signature-Previous after the overlap window expires', async () => {
    findWebhook.mockResolvedValue({
      ...baseDeliveryContext,
      encryptedSecretPrevious: 'enc:previous',
      // Rotated 100 hours ago — well past the default 24h window.
      secretRotatedAt: new Date(Date.now() - 100 * 60 * 60 * 1000),
    });
    const repository = createDeliveryAttemptRepositoryMock();
    await processWebhookDeliveryAttempt(
      42,
      'org_public_1',
      { id: 'job-rotation-stale', attemptsMade: 0 },
      fetchMock,
      repository as never,
    );
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(requestInit.headers).not.toHaveProperty('X-Webhook-Signature-Previous');
  });
});
