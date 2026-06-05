import {
  redactSensitive,
  redactSensitiveQueryString,
} from '@/shared/utils/security/sensitive-redaction.util.js';

/**
 * Flattens a `Headers` or plain record into a `Record<string, string>` with sensitive
 * values (authorization, cookie, api-key, etc.) replaced by `[REDACTED]` markers — safe
 * for inclusion in outbound log lines and Sentry breadcrumbs.
 */
export function redactOutboundHeaders(
  headers: Record<string, string> | Headers,
): Record<string, string> {
  const record: Record<string, string> = {};
  if (headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      record[key] = value;
    }
  } else {
    Object.assign(record, headers);
  }
  return redactSensitive(record);
}

/**
 * Redacts secrets from an outbound request body before logging. Form-encoded strings
 * (`a=1&token=…`) are scrubbed key-by-key; JSON strings are parsed and run through the
 * recursive `redactSensitive` formatter; non-JSON strings longer than 500 characters are
 * truncated with an ellipsis so log lines stay bounded.
 */
export function redactOutboundBody(body: unknown): unknown {
  if (typeof body === 'string') {
    if (body.includes('=') && !body.startsWith('{')) {
      return redactSensitiveQueryString(body);
    }
    try {
      const parsed = JSON.parse(body) as unknown;
      return redactSensitive(parsed);
    } catch {
      return body.length > 500 ? `${body.slice(0, 500)}…` : body;
    }
  }
  return redactSensitive(body);
}
