import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY } from '@/shared/utils/http/pagination.util.js';
import {
  validateCreateWebhook,
  validateListWebhookDeliveryAttemptsQuery,
  validateListWebhooksQuery,
  validateUpdateWebhook,
} from '@/domains/notify/sub-domains/webhook/webhook.validator.js';

describe('webhook.validator', () => {
  it('validateCreateWebhook accepts url and events', () => {
    const input = {
      url: 'https://example.com/webhook',
      events: ['user.created'],
    };
    const result = validateCreateWebhook(input);
    expect(result.url).toBe(input.url);
    expect(result.events).toEqual(['user.created']);
    expect(result.is_enabled).toBe(true);
  });

  it('validateUpdateWebhook accepts partial fields', () => {
    expect(validateUpdateWebhook({ is_enabled: false })).toEqual({ is_enabled: false });
  });

  it('validateCreateWebhook throws for empty events', () => {
    expect(() => validateCreateWebhook({ url: 'https://example.com/hook', events: [] })).toThrow(
      ValidationError,
    );
  });

  it('validateCreateWebhook throws for invalid url', () => {
    expect(() => validateCreateWebhook({ url: 'not-a-url', events: ['user.created'] })).toThrow(
      ValidationError,
    );
  });

  it('validateUpdateWebhook rejects empty events array', () => {
    expect(() => validateUpdateWebhook({ events: [] })).toThrow(ValidationError);
  });

  it('validateCreateWebhook rejects strict unknown keys', () => {
    expect(() =>
      validateCreateWebhook({
        url: 'https://example.com/hook',
        events: ['user.created'],
        unknown: true,
      }),
    ).toThrow(ValidationError);
  });

  describe('validateListWebhooksQuery (cursor pagination)', () => {
    it('returns defaults when called with empty query', () => {
      const parsed = validateListWebhooksQuery({});
      expect(parsed).toMatchObject({ include_total: 'false' });
      expect(parsed.after).toBeUndefined();
      expect(typeof parsed.limit).toBe('number');
    });

    it('accepts an opaque after cursor', () => {
      const parsed = validateListWebhooksQuery({
        after: 'eyJjcmVhdGVkX2F0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiaWQiOjF9',
        limit: '25',
      });
      expect(parsed.after).toBe('eyJjcmVhdGVkX2F0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiaWQiOjF9');
      expect(parsed.limit).toBe(25);
    });

    it('rejects legacy page query parameter with a cursor-only message', () => {
      try {
        validateListWebhooksQuery({ page: '2', limit: '5' });
        expect.fail('expected ValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        expect(validationError.statusCode).toBe(400);
        expect(validationError.messageKey).toBe(LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY);
        expect(validationError.errors).toEqual([
          { field: 'page', messageKey: LEGACY_PAGE_NOT_SUPPORTED_MESSAGE_KEY },
        ]);
      }
    });

    it('rejects unknown query keys (strict)', () => {
      expect(() => validateListWebhooksQuery({ unknown: '1' })).toThrow(ValidationError);
    });

    it('rejects non-boolean include_total values', () => {
      expect(() => validateListWebhooksQuery({ include_total: 'maybe' })).toThrow(ValidationError);
    });

    it('rejects limit outside allowed range', () => {
      expect(() => validateListWebhooksQuery({ limit: '0' })).toThrow(ValidationError);
      expect(() => validateListWebhooksQuery({ limit: '1000' })).toThrow(ValidationError);
    });
  });

  describe('validateListWebhookDeliveryAttemptsQuery (cursor pagination)', () => {
    it('returns defaults when called with empty query', () => {
      const parsed = validateListWebhookDeliveryAttemptsQuery({});
      expect(parsed.include_total).toBe('false');
      expect(parsed.after).toBeUndefined();
    });

    it('accepts after cursor and include_total=true together', () => {
      const parsed = validateListWebhookDeliveryAttemptsQuery({
        after: 'cursor-token',
        limit: '10',
        include_total: 'true',
      });
      expect(parsed.after).toBe('cursor-token');
      expect(parsed.limit).toBe(10);
      expect(parsed.include_total).toBe('true');
    });

    it('rejects unknown query keys (strict)', () => {
      expect(() => validateListWebhookDeliveryAttemptsQuery({ unknown: 'value' })).toThrow(
        ValidationError,
      );
    });
  });
});
