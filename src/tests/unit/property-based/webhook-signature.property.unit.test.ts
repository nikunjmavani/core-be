import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  signWebhookPayload,
  verifyWebhookPayloadSignature,
} from '@/shared/utils/security/webhook-signature.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

const secretArbitrary = fc.string({ minLength: 8, maxLength: 64 });
const payloadArbitrary = fc.string({ minLength: 0, maxLength: 2048 });
const timestampArbitrary = fc.integer({ min: 1_600_000_000, max: 2_000_000_000 });

describe('webhook signature (property)', () => {
  it('verify accepts signatures produced by sign for the same inputs', () => {
    fc.assert(
      fc.property(
        secretArbitrary,
        payloadArbitrary,
        timestampArbitrary,
        (secret, payload, timestamp) => {
          const signature = signWebhookPayload(secret, payload, timestamp);
          expect(verifyWebhookPayloadSignature(secret, payload, timestamp, signature)).toBe(true);
        },
      ),
      propertyOptions,
    );
  });

  it('changing the payload invalidates the signature', () => {
    fc.assert(
      fc.property(
        secretArbitrary,
        payloadArbitrary,
        payloadArbitrary,
        timestampArbitrary,
        (secret, payloadA, payloadB, timestamp) => {
          fc.pre(payloadA !== payloadB);
          const signature = signWebhookPayload(secret, payloadA, timestamp);
          expect(verifyWebhookPayloadSignature(secret, payloadB, timestamp, signature)).toBe(false);
        },
      ),
      propertyOptions,
    );
  });

  it('changing the timestamp invalidates the signature', () => {
    fc.assert(
      fc.property(
        secretArbitrary,
        payloadArbitrary,
        timestampArbitrary,
        timestampArbitrary,
        (secret, payload, timestampA, timestampB) => {
          fc.pre(timestampA !== timestampB);
          const signature = signWebhookPayload(secret, payload, timestampA);
          expect(verifyWebhookPayloadSignature(secret, payload, timestampB, signature)).toBe(false);
        },
      ),
      propertyOptions,
    );
  });
});
