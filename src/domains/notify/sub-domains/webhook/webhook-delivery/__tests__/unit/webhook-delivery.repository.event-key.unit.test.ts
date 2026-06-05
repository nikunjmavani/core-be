import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertMock, valuesMock, onConflictDoNothingMock, returningMock } = vi.hoisted(() => {
  const returningMock = vi.fn().mockResolvedValue([{ id: 7 }]);
  const onConflictDoNothingMock = vi.fn().mockReturnValue({ returning: returningMock });
  const valuesMock = vi.fn().mockReturnValue({
    onConflictDoNothing: onConflictDoNothingMock,
    returning: returningMock,
  });
  const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
  return { insertMock, valuesMock, onConflictDoNothingMock, returningMock };
});

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  getRequestDatabase: vi.fn(() => ({ insert: insertMock })),
  setLocalDatabaseConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/database/contexts/worker-database.context.js', () => ({
  assertWorkerDatabaseContext: vi.fn(),
}));

vi.mock('@/infrastructure/database/contexts/worker-database-guard.util.js', () => ({
  resolveRepositoryDatabaseHandle: vi.fn((handle) => handle ?? { insert: insertMock }),
}));

import { createPendingWebhookDeliveryAttempt } from '@/domains/notify/sub-domains/webhook/webhook-delivery/webhook-delivery.repository.js';

/**
 * Regression for sec-N2 (Medium): partial unique index
 * `idx_webhook_delivery_attempts_pending_event_key ON (webhook_id, event_key)
 * WHERE status='PENDING' AND event_key IS NOT NULL` exists but
 * `createPendingWebhookDeliveryAttempt` never populated `event_key`.
 * Net effect: a Stripe handler that re-runs (BullMQ retry, transient DB blip)
 * created N duplicate PENDING rows for ONE logical event, fanning out N
 * duplicate signed POSTs to subscribers.
 *
 * The fix plumbs an optional `eventKey` through the input and, when present,
 * inserts `event_key` and uses `onConflictDoNothing({ target: [webhook_id,
 * event_key] })` so a retry of the same logical event is a no-op against the
 * existing PENDING row. Calls without `eventKey` keep today's plain-insert
 * shape (backward compatible).
 */
describe('createPendingWebhookDeliveryAttempt — event_key dedupe (sec-N2)', () => {
  beforeEach(() => {
    insertMock.mockClear();
    valuesMock.mockClear();
    onConflictDoNothingMock.mockClear();
    returningMock.mockClear();
    returningMock.mockResolvedValue([{ id: 7 }]);
  });

  it('persists event_key when provided and applies onConflictDoNothing(webhook_id, event_key)', async () => {
    await createPendingWebhookDeliveryAttempt({
      webhookId: 1,
      eventType: 'subscription.updated',
      payload: { ok: true },
      eventKey: 'stripe_evt_abc',
    });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = valuesMock.mock.calls[0]?.[0];
    expect(inserted).toMatchObject({
      webhook_id: 1,
      event_type: 'subscription.updated',
      event_key: 'stripe_evt_abc',
      status: 'PENDING',
    });
    expect(onConflictDoNothingMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT use onConflictDoNothing when no eventKey is provided (backward compatible)', async () => {
    await createPendingWebhookDeliveryAttempt({
      webhookId: 1,
      eventType: 'subscription.updated',
      payload: { ok: true },
    });
    expect(valuesMock).toHaveBeenCalledTimes(1);
    const inserted = valuesMock.mock.calls[0]?.[0];
    expect(inserted).not.toHaveProperty('event_key');
    expect(onConflictDoNothingMock).not.toHaveBeenCalled();
  });
});
