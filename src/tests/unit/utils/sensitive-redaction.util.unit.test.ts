import { describe, expect, it } from 'vitest';
import {
  redactSensitive,
  SENSITIVE_REDACTION_PLACEHOLDER,
} from '@/shared/utils/security/sensitive-redaction.util.js';

describe('redactSensitive', () => {
  it('redacts case-insensitive and nested sensitive keys', () => {
    const input = {
      Authorization: 'Bearer abc',
      headers: {
        'X-Api-Key': 'k-123',
        'set-cookie': 'session=zzz',
        'content-type': 'application/json',
      },
      body: {
        password: 'hunter2',
        nested: { refresh_token: 'r-1', keepThis: 'visible' },
      },
      raw_key: 'sk_live_xyz',
    };

    const result = redactSensitive(input);

    expect(result.Authorization).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.headers['X-Api-Key']).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.headers['set-cookie']).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.body.password).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.body.nested.refresh_token).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.body.nested.keepThis).toBe('visible');
    expect(result.raw_key).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
  });

  it('redacts sensitive keys inside arrays', () => {
    const input = { items: [{ apiKey: 'a' }, { name: 'ok' }] };
    const result = redactSensitive(input);
    expect(result.items[0]!.apiKey).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.items[1]!.name).toBe('ok');
  });

  it('does not mutate the original object', () => {
    const input = { token: 'secret-value' };
    const result = redactSensitive(input);
    expect(input.token).toBe('secret-value');
    expect(result.token).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
  });

  it('returns primitives unchanged', () => {
    expect(redactSensitive('plain')).toBe('plain');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBeNull();
  });

  it('is bounded on cyclic structures', () => {
    const cyclic: Record<string, unknown> = { name: 'root', password: 'x' };
    cyclic.self = cyclic;
    expect(() => redactSensitive(cyclic)).not.toThrow();
    const result = redactSensitive(cyclic) as Record<string, unknown>;
    expect(result.password).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
  });
});
