/**
 * Curates captured route examples into the committed OpenAPI fixture.
 *
 * Input: `route-coverage-observed/examples-*.json` fragments written by the
 * test-app observer during a capture run:
 *
 *   ROUTE_EXAMPLE_CAPTURE=1 pnpm test && pnpm routes:examples
 *
 * For every catalog route the first captured sample per status is kept — the
 * request body from the route's declared-success sample plus one response body
 * per observed status — then **sanitized** (secret redaction + volatile-value
 * normalization, see below) and written to
 * `tooling/openapi/route-examples/route-examples.json` (committed). The OpenAPI
 * generator merges these into each operation as named `captured` examples, so
 * the published spec shows real request/response shapes from live API calls.
 *
 * Sanitization is deliberately paranoid: values are redacted both by field
 * name (tokens, secrets, passwords, recovery codes…) and by value pattern
 * (JWTs, long high-entropy strings, Stripe-style prefixes, otpauth URIs);
 * emails, UUIDs, public ids, timestamps, and URLs are normalized to fixed
 * placeholders so the committed file is deterministic and free of PII.
 *
 * The fixture only changes when this command is re-run — docs generation reads
 * the committed file, keeping `pnpm docs:check` deterministic.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import {
  loadRouteSuccessStatusMap,
  routeSuccessStatusKey,
} from '@/tests/helpers/route-success-status.helper.js';
import { ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME } from '@tooling/route-coverage/constants.js';
import { ROUTE_EXAMPLES_PATH } from '@tooling/openapi/route-examples/constants.js';

type CapturedExample = { request_body?: unknown; response_body?: unknown };
type RouteExamples = {
  request_body?: unknown;
  responses: Record<string, unknown>;
};

const REDACTED = '<redacted>';

/** Field names whose values are always redacted (exact, lower-cased). */
const SECRET_FIELD_NAMES = new Set([
  'access_token',
  'refresh_token',
  'token',
  'mfa_session_token',
  'session_refresh_secret',
  'secret',
  'password',
  'current_password',
  'new_password',
  'authorization',
  'provisioning_uri',
  'recovery_code',
]);

const SECRET_FIELD_SUFFIXES = ['_token', '_secret', '_password', '_key'];

/** Value patterns that are redacted wherever they appear. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT
  /^[a-z]{2,8}_[A-Za-z0-9]{16,}$/, // prefixed opaque credentials (ak_, sk_, whsec_, …)
  /^(sk|pk|rk|whsec|cus|sub|price)_[A-Za-z0-9_]{8,}$/, // Stripe-style identifiers/secrets
  /^otpauth:\/\//, // TOTP provisioning URIs
  /^[A-Fa-f0-9]{32,}$/, // long hex blobs (hashes, raw tokens)
];

const KNOWN_PUBLIC_ID_PREFIXES = [
  'usr',
  'org',
  'mem',
  'inv',
  'rol',
  'key',
  'pol',
  'ses',
  'am',
  'mfa',
  'ntf',
  'whk',
  'pln',
  'sub',
  'upl',
  'exp',
  'wda',
];
const PREFIXED_PUBLIC_ID_PATTERN = new RegExp(
  `^(${KNOWN_PUBLIC_ID_PREFIXES.join('|')})_[a-z0-9]{21}$`,
);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const PUBLIC_ID_PATTERN = /^[a-z0-9]{21}$/;
const URL_PATTERN = /^https?:\/\//;

const PLACEHOLDERS = {
  email: 'user@example.com',
  uuid: '00000000-0000-4000-8000-000000000000',
  isoDate: '2026-01-01T00:00:00.000Z',
  publicId: 'example00000000000pid',
  url: 'https://example.com/resource',
};

function isSecretFieldName(fieldName: string): boolean {
  const lower = fieldName.toLowerCase();
  if (SECRET_FIELD_NAMES.has(lower)) return true;
  return SECRET_FIELD_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function sanitizeString(value: string): string {
  // Opaque base64-JSON pagination cursors ("eyJ…", no dots) embed timestamps
  // and internal ids — normalize before the JWT check (JWTs have dots).
  if (/^eyJ[A-Za-z0-9+/=_-]{8,}$/.test(value)) return '<opaque-cursor>';
  // Prefixed public ids normalize to a stable per-entity placeholder BEFORE the
  // credential patterns (which would otherwise redact every typed id).
  const prefixedId = PREFIXED_PUBLIC_ID_PATTERN.exec(value);
  if (prefixedId) return `${prefixedId[1]}_example00000000000000`;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(value)) return REDACTED;
  }
  if (EMAIL_PATTERN.test(value)) return PLACEHOLDERS.email;
  if (UUID_PATTERN.test(value)) return PLACEHOLDERS.uuid;
  if (ISO_DATE_PATTERN.test(value)) return PLACEHOLDERS.isoDate;
  if (PUBLIC_ID_PATTERN.test(value)) return PLACEHOLDERS.publicId;
  if (URL_PATTERN.test(value)) return PLACEHOLDERS.url;
  return value;
}

function sanitize(value: unknown, parentFieldName?: string): unknown {
  if (typeof value === 'string') {
    if (parentFieldName && isSecretFieldName(parentFieldName)) return REDACTED;
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    if (parentFieldName && isSecretFieldName(`${parentFieldName.replace(/s$/, '')}`)) {
      return [REDACTED];
    }
    return value.slice(0, 2).map((item) => sanitize(item, parentFieldName));
  }
  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [fieldName, fieldValue] of Object.entries(value as Record<string, unknown>)) {
      const isRedactableLeaf =
        typeof fieldValue === 'string' ||
        typeof fieldValue === 'number' ||
        Array.isArray(fieldValue);
      if (isSecretFieldName(fieldName) && isRedactableLeaf) {
        sanitized[fieldName] = Array.isArray(fieldValue) ? [REDACTED] : REDACTED;
        continue;
      }
      sanitized[fieldName] = sanitize(fieldValue, fieldName);
    }
    return sanitized;
  }
  return value;
}

function main(): void {
  const observedDirectory = resolve(process.cwd(), ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME);
  if (!existsSync(observedDirectory)) {
    console.error(
      `No ${ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME}/ directory. Run a capture first:\n` +
        '  ROUTE_EXAMPLE_CAPTURE=1 pnpm test && pnpm routes:examples',
    );
    process.exit(1);
  }

  const fragments = readdirSync(observedDirectory)
    .filter((entry) => entry.startsWith('examples-') && entry.endsWith('.json'))
    .sort();
  if (fragments.length === 0) {
    console.error(
      'No examples-*.json fragments found. Run the suite with ROUTE_EXAMPLE_CAPTURE=1 first.',
    );
    process.exit(1);
  }

  const captured = new Map<string, CapturedExample>();
  for (const fragment of fragments) {
    const content = JSON.parse(readFileSync(join(observedDirectory, fragment), 'utf-8')) as Record<
      string,
      CapturedExample
    >;
    for (const [key, sample] of Object.entries(content)) {
      if (!captured.has(key)) {
        captured.set(key, sample);
      }
    }
  }

  const registry = loadRouteRegistryFromCatalog();
  const successStatusMap = loadRouteSuccessStatusMap();
  const output: Record<string, RouteExamples> = {};
  let responseCount = 0;

  for (const route of registry) {
    const routeKey = routeSuccessStatusKey(route);
    const declaredStatus = successStatusMap[routeKey];
    const responses: Record<string, unknown> = {};
    let requestBody: unknown;

    for (const [key, sample] of captured) {
      const lastSpace = key.lastIndexOf(' ');
      const status = key.slice(lastSpace + 1);
      if (key.slice(0, lastSpace) !== routeKey) continue;
      if (Number(status) >= 500) continue; // 5xx bodies are not contract examples
      if (sample.response_body !== undefined && responses[status] === undefined) {
        const sanitized = sanitize(sample.response_body) as Record<string, unknown>;
        if (sanitized && typeof sanitized === 'object' && sanitized.meta) {
          // Deterministic, realistic-looking request id derived from the route+status
          // so examples read like production traffic while staying reproducible.
          const digest = createHash('sha256').update(`${routeKey} ${status}`).digest('hex');
          (sanitized.meta as Record<string, unknown>).request_id =
            `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-9${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        }
        responses[status] = sanitized;
        responseCount += 1;
      }
      if (String(declaredStatus) === status && sample.request_body !== undefined) {
        requestBody = sanitize(sample.request_body);
      }
    }

    if (Object.keys(responses).length > 0) {
      output[routeKey] = {
        ...(requestBody !== undefined ? { request_body: requestBody } : {}),
        responses: Object.fromEntries(Object.entries(responses).sort()),
      };
    }
  }

  const sorted = Object.fromEntries(Object.entries(output).sort());
  writeFileSync(
    resolve(process.cwd(), ROUTE_EXAMPLES_PATH),
    `${JSON.stringify(sorted, null, 2)}\n`,
  );
  console.log(
    `Wrote ${Object.keys(sorted).length} routes / ${responseCount} response examples to ${ROUTE_EXAMPLES_PATH}`,
  );
}

main();
