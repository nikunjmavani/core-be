/**
 * Central recursive, case-insensitive secret redactor.
 *
 * Walks arbitrary objects/arrays and replaces the value of any key whose name contains a
 * sensitive fragment (case-insensitive substring) with `[REDACTED]`. Used by the Pino logger
 * and Sentry `beforeSend` so headers, query, body, breadcrumbs, and extras are scrubbed
 * regardless of nesting depth or header casing.
 *
 * String values that look like URLs or query strings have sensitive parameter values scrubbed.
 * Returns a redacted deep copy — never mutates the input. Cyclic references are tracked via
 * WeakMap so the original object graph is never returned from a cycle or depth boundary.
 */
export const SENSITIVE_REDACTION_PLACEHOLDER = '[REDACTED]';

const MAX_REDACTION_DEPTH = 8;

/**
 * Lower-cased substrings that mark a key as sensitive. Substring (not exact) matching catches
 * casing and nesting variants: `Authorization`, `X-Api-Key`, `set-cookie`, `raw_key`,
 * `body.refresh_token`, etc.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'authorization',
  'password',
  'passwd',
  'secret',
  'token',
  'cookie',
  'api_key',
  'apikey',
  'api-key',
  'raw_key',
  'rawkey',
  'access_key_id',
  'private_key',
  'encryption_key',
  'session_id',
  'jwt',
  'credential',
] as const;

interface RedactionContext {
  readonly visited: WeakMap<object, Record<string, unknown> | unknown[]>;
  readonly depth: number;
}

export function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalizedKey.includes(fragment));
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.includes('://');
}

function looksLikeQueryString(value: string): boolean {
  if (!value.includes('=')) {
    return false;
  }
  const queryPortion = value.startsWith('?') ? value.slice(1) : value;
  return queryPortion.split('&').some((pair) => pair.includes('='));
}

function decodeQueryParameterName(parameterName: string): string {
  try {
    return decodeURIComponent(parameterName.replace(/\+/g, ' '));
  } catch {
    return parameterName;
  }
}

/**
 * Redacts sensitive query parameter values in an application/x-www-form-urlencoded string.
 */
export function redactSensitiveQueryString(query: string): string {
  const hasLeadingQuestionMark = query.startsWith('?');
  const queryPortion = hasLeadingQuestionMark ? query.slice(1) : query;
  if (!queryPortion.includes('=')) {
    return query;
  }

  let changed = false;
  const redactedPairs = queryPortion.split('&').map((pair) => {
    const equalsIndex = pair.indexOf('=');
    if (equalsIndex === -1) {
      return pair;
    }

    const parameterName = pair.slice(0, equalsIndex);
    if (!isSensitiveKey(decodeQueryParameterName(parameterName))) {
      return pair;
    }

    changed = true;
    return `${parameterName}=${SENSITIVE_REDACTION_PLACEHOLDER}`;
  });

  if (!changed) {
    return query;
  }

  const redactedQuery = redactedPairs.join('&');
  return hasLeadingQuestionMark ? `?${redactedQuery}` : redactedQuery;
}

/**
 * Redacts sensitive query parameter values in a full URL string.
 */
export function redactSensitiveUrl(url: string): string {
  if (!looksLikeUrl(url)) {
    const questionMarkIndex = url.indexOf('?');
    if (questionMarkIndex === -1) {
      return url;
    }
    return `${url.slice(0, questionMarkIndex + 1)}${redactSensitiveQueryString(url.slice(questionMarkIndex))}`;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.search) {
      const redactedSearch = redactSensitiveQueryString(parsedUrl.search);
      return `${parsedUrl.origin}${parsedUrl.pathname}${redactedSearch}${parsedUrl.hash}`;
    }
    return parsedUrl.toString();
  } catch {
    const questionMarkIndex = url.indexOf('?');
    if (questionMarkIndex === -1) {
      return url;
    }
    return `${url.slice(0, questionMarkIndex + 1)}${redactSensitiveQueryString(url.slice(questionMarkIndex))}`;
  }
}

function redactSensitiveString(value: string): string {
  if (looksLikeUrl(value)) {
    return redactSensitiveUrl(value);
  }
  if (looksLikeQueryString(value)) {
    return redactSensitiveQueryString(value);
  }
  return value;
}

function redactValue<T>(input: T, context: RedactionContext): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return redactSensitiveString(input) as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (context.depth >= MAX_REDACTION_DEPTH) {
    return SENSITIVE_REDACTION_PLACEHOLDER as T;
  }

  if (Array.isArray(input)) {
    const existingArray = context.visited.get(input);
    if (existingArray !== undefined) {
      return existingArray as T;
    }

    const output: unknown[] = [];
    context.visited.set(input, output);
    for (const item of input) {
      output.push(redactValue(item, { ...context, depth: context.depth + 1 }));
    }
    return output as T;
  }

  const existingObject = context.visited.get(input);
  if (existingObject !== undefined) {
    return existingObject as T;
  }

  const output: Record<string, unknown> = {};
  context.visited.set(input, output);

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // eslint-disable-next-line security/detect-object-injection -- key from Object.entries of the input being redacted; written to a fresh local object.
    output[key] = isSensitiveKey(key)
      ? SENSITIVE_REDACTION_PLACEHOLDER
      : redactValue(value, { ...context, depth: context.depth + 1 });
  }
  return output as T;
}

export function redactSensitive<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return redactSensitiveString(input) as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  return redactValue(input, { visited: new WeakMap(), depth: 0 });
}
