import { describe, expect, it } from 'vitest';
import { notificationJobDataSchema } from '@/domains/notify/sub-domains/notification/queues/notification.job.schema.js';

/**
 * The boundary between Redis and the notification worker. A BullMQ payload is untrusted input in
 * the same sense a request body is — it can be hand-written into the queue, replayed from the DLQ,
 * or left over from an older deploy with a different shape. This schema was untested, including
 * the `organizationPublicId` field that tenant-scoped worker jobs rely on for their RLS context.
 */
describe('notification.job.schema', () => {
  const validJob = {
    notificationId: 1234,
    organizationPublicId: 'org_abcdefghijklmnopqrstu',
  };

  describe('accepts', () => {
    it('a minimal valid payload', () => {
      expect(notificationJobDataSchema.safeParse(validJob).success).toBe(true);
    });

    it('a null organizationPublicId — a user-scoped notification has no organization', () => {
      const result = notificationJobDataSchema.safeParse({
        notificationId: 1,
        organizationPublicId: null,
      });

      expect(result.success).toBe(true);
    });

    it('an optional requestId for log correlation', () => {
      const result = notificationJobDataSchema.safeParse({ ...validJob, requestId: 'req_abc' });

      expect(result.success).toBe(true);
    });

    it('a payload with no requestId at all', () => {
      expect(notificationJobDataSchema.safeParse(validJob).success).toBe(true);
    });
  });

  describe('notificationId', () => {
    it.each([
      ['zero', 0],
      ['a negative id', -1],
      ['a fractional id', 1.5],
      ['a string id', '1234'],
      ['null', null],
      ['NaN', Number.NaN],
    ])('rejects %s', (_label, notificationId) => {
      const result = notificationJobDataSchema.safeParse({ ...validJob, notificationId });

      expect(result.success).toBe(false);
    });

    it('rejects a payload with no notificationId', () => {
      expect(notificationJobDataSchema.safeParse({ organizationPublicId: null }).success).toBe(
        false,
      );
    });

    it('accepts 1 as the smallest valid id', () => {
      expect(notificationJobDataSchema.safeParse({ ...validJob, notificationId: 1 }).success).toBe(
        true,
      );
    });
  });

  describe('organizationPublicId', () => {
    it('rejects an empty string — null means "no organization", "" means a bug', () => {
      const result = notificationJobDataSchema.safeParse({
        ...validJob,
        organizationPublicId: '',
      });

      expect(result.success).toBe(false);
    });

    it('rejects an id longer than 28 characters', () => {
      const result = notificationJobDataSchema.safeParse({
        ...validJob,
        organizationPublicId: 'o'.repeat(29),
      });

      expect(result.success).toBe(false);
    });

    it('accepts an id of exactly 28 characters (max boundary)', () => {
      const result = notificationJobDataSchema.safeParse({
        ...validJob,
        organizationPublicId: 'o'.repeat(28),
      });

      expect(result.success).toBe(true);
    });

    it('rejects a numeric organization id', () => {
      const result = notificationJobDataSchema.safeParse({
        ...validJob,
        organizationPublicId: 42,
      });

      expect(result.success).toBe(false);
    });

    it('rejects a payload that omits organizationPublicId entirely', () => {
      // Nullable, but not optional — a tenant-scoped job must state its scope explicitly
      // rather than inheriting whatever context the worker happens to be in.
      expect(notificationJobDataSchema.safeParse({ notificationId: 1 }).success).toBe(false);
    });
  });

  describe('requestId', () => {
    it('rejects an empty requestId', () => {
      expect(notificationJobDataSchema.safeParse({ ...validJob, requestId: '' }).success).toBe(
        false,
      );
    });

    it('rejects a requestId longer than 128 characters', () => {
      expect(
        notificationJobDataSchema.safeParse({ ...validJob, requestId: 'r'.repeat(129) }).success,
      ).toBe(false);
    });

    it('accepts a requestId of exactly 128 characters (max boundary)', () => {
      expect(
        notificationJobDataSchema.safeParse({ ...validJob, requestId: 'r'.repeat(128) }).success,
      ).toBe(true);
    });
  });

  describe('composed trace-context and DLQ-replay fields', () => {
    it('carries the trace-context and replay shapes into the parsed payload', () => {
      // The schema extends both shared job-field schemas; a valid payload must survive the merge
      // rather than being stripped or rejected by the composition.
      const result = notificationJobDataSchema.safeParse(validJob);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notificationId).toBe(1234);
        expect(result.data.organizationPublicId).toBe('org_abcdefghijklmnopqrstu');
      }
    });
  });

  describe('non-object payloads', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'notification'],
      ['a number', 7],
      ['an array', []],
    ])('rejects %s', (_label, payload) => {
      expect(notificationJobDataSchema.safeParse(payload).success).toBe(false);
    });
  });
});
