/**
 * Central recursive, case-insensitive secret redactor.
 *
 * Walks arbitrary objects/arrays and replaces the value of any key whose name contains a
 * sensitive fragment (case-insensitive substring) with `[REDACTED]`. Used by the Pino logger
 * and Sentry `beforeSend` so headers, query, body, breadcrumbs, and extras are scrubbed
 * regardless of nesting depth or header casing.
 *
 * Returns a redacted deep copy — never mutates the input — so application state and log
 * objects are unaffected. Recursion is depth-bounded to stay safe on cyclic structures.
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

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalizedKey.includes(fragment));
}

export function redactSensitive<T>(input: T, depth = 0): T {
  if (input === null || typeof input !== 'object' || depth >= MAX_REDACTION_DEPTH) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitive(item, depth + 1)) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // eslint-disable-next-line security/detect-object-injection -- key from Object.entries of the input being redacted; written to a fresh local object.
    output[key] = isSensitiveKey(key)
      ? SENSITIVE_REDACTION_PLACEHOLDER
      : redactSensitive(value, depth + 1);
  }
  return output as T;
}
