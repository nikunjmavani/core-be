import { describe, expect, it } from 'vitest';
import { notificationJobDataSchema } from '@/domains/notify/sub-domains/notification/queues/notification.job.schema.js';

/**
 * The `notification` queue's payload gate.
 *
 * This schema parses an untrusted payload read back off Redis before the worker touches
 * Postgres — a corrupted or hand-crafted job must fail here rather than mid-transaction.
 * Billing's `stripe-webhook.job.schema.ts` has a unit test; neither notify job schema did.
 *
 * Note the deliberate contrast with the webhook-delivery schema: `organizationPublicId` here is
 * `.nullable()` but still **required**, because a user-only notification legitimately has no
 * tenant while a missing key is a producer bug.
 */
describe('notificationJobDataSchema', () => {
  const validPayload = {
    notificationId: 42,
    organizationPublicId: 'org_abcdefghijklmnopqrstu',
    requestId: 'request-1',
  };

  it('accepts a well-formed tenant-scoped payload', () => {
    const parsed = notificationJobDataSchema.safeParse(validPayload);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      notificationId: 42,
      organizationPublicId: 'org_abcdefghijklmnopqrstu',
      requestId: 'request-1',
    });
  });

  it('accepts a null organizationPublicId for a user-only notification', () => {
    // User-scoped notifications carry no tenant. This is the reason the field is nullable
    // rather than optional — see notification-dispatch.service.
    const parsed = notificationJobDataSchema.safeParse({
      notificationId: 42,
      organizationPublicId: null,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.organizationPublicId).toBeNull();
  });

  it('carries the merged trace-context and DLQ-replay fields through', () => {
    // The two .extend() calls are the only thing keeping API→worker spans linked and DLQ
    // replay provenance intact; a dropped extend would silently strip both.
    const parsed = notificationJobDataSchema.safeParse({
      ...validPayload,
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'vendor=value',
      replayFromDlq: true,
      dlqReplayAttempt: 2,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'vendor=value',
      replayFromDlq: true,
      dlqReplayAttempt: 2,
    });
  });

  it('rejects a payload with no notificationId', () => {
    const parsed = notificationJobDataSchema.safeParse({
      organizationPublicId: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejects an omitted organizationPublicId (nullable, not optional)', () => {
    const parsed = notificationJobDataSchema.safeParse({ notificationId: 42 });

    expect(parsed.success).toBe(false);
  });

  it.each([
    ['a string notificationId', { notificationId: '42', organizationPublicId: null }],
    ['a fractional notificationId', { notificationId: 1.5, organizationPublicId: null }],
    ['a zero notificationId', { notificationId: 0, organizationPublicId: null }],
    ['a negative notificationId', { notificationId: -1, organizationPublicId: null }],
    [
      'an over-long organizationPublicId',
      { notificationId: 42, organizationPublicId: 'o'.repeat(29) },
    ],
    ['an empty requestId', { notificationId: 42, organizationPublicId: null, requestId: '' }],
  ])('rejects %s', (_label, payload) => {
    expect(notificationJobDataSchema.safeParse(payload).success).toBe(false);
  });

  it('strips unknown keys rather than rejecting them', () => {
    // Documents the actual contract: the schema is a plain z.object, not .strict(). A future
    // switch to .strict() would break DLQ replay of jobs enqueued by an older deploy, so the
    // stripping behaviour is deliberate and worth pinning.
    const parsed = notificationJobDataSchema.safeParse({
      ...validPayload,
      attackerControlled: 'ignored',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty('attackerControlled');
  });
});
