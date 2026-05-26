import {
  redactSensitive,
  redactSensitiveQueryString,
} from '@/shared/utils/security/sensitive-redaction.util.js';

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
  return redactSensitive(record) as Record<string, string>;
}

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
