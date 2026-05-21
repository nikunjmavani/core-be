import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import {
  validateCreateWebhook,
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
});
