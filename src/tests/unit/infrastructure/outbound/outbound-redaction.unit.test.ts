import { describe, it, expect } from 'vitest';
import {
  redactOutboundBody,
  redactOutboundHeaders,
} from '@/infrastructure/outbound/outbound-redaction.js';
import { SENSITIVE_REDACTION_PLACEHOLDER } from '@/shared/utils/security/sensitive-redaction.util.js';

const REDACTED = SENSITIVE_REDACTION_PLACEHOLDER;

describe('redactOutboundHeaders', () => {
  it('flattens a Headers instance and redacts sensitive values', () => {
    const headers = new Headers({
      authorization: 'Bearer super-secret-token',
      'content-type': 'application/json',
    });
    expect(redactOutboundHeaders(headers)).toEqual({
      authorization: REDACTED,
      'content-type': 'application/json',
    });
  });

  it('redacts sensitive keys in a plain record and passes non-sensitive values through', () => {
    expect(
      redactOutboundHeaders({
        'X-Api-Key': 'live-key-1234',
        accept: 'application/json',
      }),
    ).toEqual({
      'X-Api-Key': REDACTED,
      accept: 'application/json',
    });
  });
});

describe('redactOutboundBody', () => {
  it('scrubs sensitive params in a form-encoded string, key by key', () => {
    expect(redactOutboundBody('code=abc123&client_secret=shh&redirect_uri=https://x')).toBe(
      `code=abc123&client_secret=${REDACTED}&redirect_uri=https://x`,
    );
  });

  it('parses a JSON string body and recursively redacts sensitive keys', () => {
    expect(redactOutboundBody('{"access_token":"abc","name":"ok"}')).toEqual({
      access_token: REDACTED,
      name: 'ok',
    });
  });

  it('truncates a non-JSON string longer than 500 characters with an ellipsis', () => {
    const long = 'x'.repeat(600);
    const result = redactOutboundBody(long);
    expect(result).toBe(`${'x'.repeat(500)}…`);
    expect((result as string).length).toBe(501);
  });

  it('returns a short non-JSON string unchanged', () => {
    expect(redactOutboundBody('hello world')).toBe('hello world');
  });

  it('redacts sensitive keys in a non-string (object) body', () => {
    expect(redactOutboundBody({ password: 'p', ok: 1 })).toEqual({
      password: REDACTED,
      ok: 1,
    });
  });
});
