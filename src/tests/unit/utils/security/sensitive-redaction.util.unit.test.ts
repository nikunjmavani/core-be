import { describe, expect, it } from 'vitest';
import {
  isSensitiveKey,
  redactSensitive,
  redactSensitiveQueryString,
  redactSensitiveUrl,
  SENSITIVE_KEY_FRAGMENTS,
  SENSITIVE_REDACTION_PLACEHOLDER,
} from '@/shared/utils/security/sensitive-redaction.util.js';
import { PINO_REDACT_PATHS } from '@/shared/utils/http/fastify-server.util.js';

// audit #27: PINO_REDACT_PATHS is now derived from SENSITIVE_KEY_FRAGMENTS (one source of truth).
// This pins the no-drift invariant: every recursive fragment is also a Pino fast-path, and every
// bare (non-nested) Pino path is recognised as sensitive by the recursive matcher.
describe('redaction single-source invariant (audit #27)', () => {
  it('PINO_REDACT_PATHS includes every SENSITIVE_KEY_FRAGMENTS entry', () => {
    for (const fragment of SENSITIVE_KEY_FRAGMENTS) {
      expect(PINO_REDACT_PATHS).toContain(fragment);
    }
  });

  it('every bare Pino path is caught by the recursive isSensitiveKey matcher', () => {
    const barePaths = PINO_REDACT_PATHS.filter(
      (path) => !(path.includes('.') || path.includes('[')),
    );
    for (const path of barePaths) {
      expect(isSensitiveKey(path)).toBe(true);
    }
  });
});

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

  it('redacts email PII keys (object and query string)', () => {
    const result = redactSensitive({
      email: 'user@example.com',
      body: { user_email: 'a@b.com', name: 'ok' },
    });
    expect(result.email).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.body.user_email).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.body.name).toBe('ok');
    expect(redactSensitive('email=user%40example.com&page=1')).toBe(
      `email=${SENSITIVE_REDACTION_PLACEHOLDER}&page=1`,
    );
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

  it('returns non-query primitives unchanged', () => {
    expect(redactSensitive('plain')).toBe('plain');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBeNull();
  });

  it('redacts sensitive values in query strings', () => {
    expect(redactSensitive('token=secret&page=1')).toBe(
      `token=${SENSITIVE_REDACTION_PLACEHOLDER}&page=1`,
    );
    expect(redactSensitive('?raw_key=sk_live&name=bob')).toBe(
      `?raw_key=${SENSITIVE_REDACTION_PLACEHOLDER}&name=bob`,
    );
  });

  it('redacts sensitive values in URL strings', () => {
    expect(redactSensitive('https://api.example.com/v1/items?api_key=secret&page=2')).toBe(
      `https://api.example.com/v1/items?api_key=${SENSITIVE_REDACTION_PLACEHOLDER}&page=2`,
    );
  });

  it('handles cyclic structures without reintroducing secrets', () => {
    const cyclic: Record<string, unknown> = { name: 'root', password: 'x' };
    cyclic.self = cyclic;
    expect(() => redactSensitive(cyclic)).not.toThrow();
    const result = redactSensitive(cyclic) as Record<string, unknown>;
    expect(result.password).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(result.self).not.toBe(cyclic);
    const nestedSelf = result.self as Record<string, unknown>;
    expect(nestedSelf.password).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
  });

  it('does not return original objects beyond max depth', () => {
    const leafSecret = 'must-not-appear-beyond-max-depth';
    const root: Record<string, unknown> = { nested: {} };
    let current = root.nested as Record<string, unknown>;
    for (let depth = 0; depth < 15; depth += 1) {
      const next: Record<string, unknown> = {};
      current.child = next;
      current = next;
    }
    current.payload = leafSecret;

    const result = redactSensitive(root) as Record<string, unknown>;
    expect(result.nested).not.toBe(root.nested);
    expect(JSON.stringify(result)).not.toContain(leafSecret);
  });
});

describe('redactSensitiveQueryString', () => {
  it('redacts only sensitive query parameter values', () => {
    expect(redactSensitiveQueryString('foo=bar&token=abc')).toBe(
      `foo=bar&token=${SENSITIVE_REDACTION_PLACEHOLDER}`,
    );
    expect(redactSensitiveQueryString('?x-api-key=secret&limit=10')).toBe(
      `?x-api-key=${SENSITIVE_REDACTION_PLACEHOLDER}&limit=10`,
    );
  });
});

describe('redactSensitiveUrl', () => {
  it('redacts sensitive query parameters in absolute URLs', () => {
    expect(redactSensitiveUrl('https://example.com/path?password=hunter2&id=1')).toBe(
      `https://example.com/path?password=${SENSITIVE_REDACTION_PLACEHOLDER}&id=1`,
    );
  });
});
