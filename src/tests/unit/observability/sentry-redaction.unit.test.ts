import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import { redactSentryEvent } from '@/infrastructure/observability/sentry/sentry.js';
import { SENSITIVE_REDACTION_PLACEHOLDER } from '@/shared/utils/security/sensitive-redaction.util.js';

describe('redactSentryEvent', () => {
  it('redacts request headers, body, query string, and url', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        headers: { Authorization: 'Bearer secret', 'content-type': 'application/json' },
        cookies: { session_id: 'sess-123' },
        data: { password: 'hunter2', name: 'visible' },
        query_string: 'token=abc&page=1',
        url: 'https://api.example.com/v1/items?raw_key=sk_live',
      },
    };

    const redacted = redactSentryEvent(event);

    expect(redacted.request?.headers?.Authorization).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(redacted.request?.headers?.['content-type']).toBe('application/json');
    expect(redacted.request?.cookies?.session_id).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(redacted.request?.data).toEqual({
      password: SENSITIVE_REDACTION_PLACEHOLDER,
      name: 'visible',
    });
    expect(redacted.request?.query_string).toBe(`token=${SENSITIVE_REDACTION_PLACEHOLDER}&page=1`);
    expect(redacted.request?.url).toBe(
      `https://api.example.com/v1/items?raw_key=${SENSITIVE_REDACTION_PLACEHOLDER}`,
    );
  });

  it('redacts breadcrumbs, extras, and contexts', () => {
    const event: ErrorEvent = {
      type: undefined,
      breadcrumbs: [
        {
          data: { 'X-Api-Key': 'k-123', route: '/health' },
        },
      ],
      extra: { api_key: 'secret', count: 2 },
      contexts: {
        request: { headers: { cookie: 'session=zzz' } },
      },
    };

    const redacted = redactSentryEvent(event);

    expect(redacted.breadcrumbs?.[0]?.data?.['X-Api-Key']).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(redacted.breadcrumbs?.[0]?.data?.route).toBe('/health');
    expect(redacted.extra?.api_key).toBe(SENSITIVE_REDACTION_PLACEHOLDER);
    expect(redacted.extra?.count).toBe(2);
    expect(redacted.contexts?.request).toEqual({
      headers: { cookie: SENSITIVE_REDACTION_PLACEHOLDER },
    });
  });
});
