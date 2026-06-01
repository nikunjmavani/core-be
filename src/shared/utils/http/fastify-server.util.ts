import { randomUUID } from 'node:crypto';
import type { FastifyServerOptions } from 'fastify';
import type { IncomingMessage } from 'node:http';
import { env } from '@/shared/config/env.config.js';
import { THIRTY_SECONDS_MS } from '@/shared/constants/ttl.constants.js';
import { redactSensitive } from '@/shared/utils/security/sensitive-redaction.util.js';

/**
 * Shared Pino redact paths — fast exact-path scrubbing for well-known fields. Keep in sync
 * with logger.util.ts. Recursive, case-insensitive scrubbing of everything else (nested
 * headers, raw_key, set-cookie, x-api-key, …) is handled by the `redactSensitive` formatter.
 */
export const PINO_REDACT_PATHS = [
  'authorization',
  'password',
  'token',
  'secret',
  'email',
  'cookie',
  'api_key',
  'access_key_id',
  'secret_access_key',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'body.password',
  'body.token',
  'body.secret',
  'body.access_token',
  'body.refresh_token',
  'body.email',
  'req.body.email',
] as const;

/**
 * Resolves the Fastify `trustProxy` value from the validated env. `TRUST_PROXY` is parsed
 * by the schema into `false | number` (a hop count); this normalizes to the shape Fastify
 * accepts and never trusts a bare boolean `true`.
 */
export function resolveTrustProxy(): boolean | number {
  const trustProxy = env.TRUST_PROXY;
  if (trustProxy === false) return false;
  if (typeof trustProxy === 'number') return trustProxy;
  return false;
}

/**
 * Maximum accepted length for a client-supplied `x-request-id`. Bounds memory/log size and
 * comfortably covers a canonical UUID (36 chars) plus common tracing token formats.
 */
const MAX_INBOUND_REQUEST_IDENTIFIER_LENGTH = 128;

/**
 * Strict allow-list for inbound `x-request-id` values: a non-empty token of safe correlation-id
 * characters (alphanumerics, hyphen, underscore) within {@link MAX_INBOUND_REQUEST_IDENTIFIER_LENGTH}.
 * Canonical UUIDs satisfy this pattern. Anything else (whitespace, control chars, separators,
 * oversized values) is rejected so attackers cannot inject arbitrary correlation ids, collide
 * with other traffic, or poison incident triage — those requests get a server-generated id.
 */
const SAFE_INBOUND_REQUEST_IDENTIFIER_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{1,${MAX_INBOUND_REQUEST_IDENTIFIER_LENGTH}}$`,
);

function isSafeInboundRequestIdentifier(candidate: string): boolean {
  return SAFE_INBOUND_REQUEST_IDENTIFIER_PATTERN.test(candidate);
}

function resolveIncomingRequestIdentifier(incomingMessage: IncomingMessage): string {
  const headerValue = incomingMessage.headers['x-request-id'];
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof candidate === 'string' && isSafeInboundRequestIdentifier(candidate)) {
    return candidate;
  }
  return randomUUID();
}

/**
 * Builds the canonical {@link FastifyServerOptions} used by both the HTTP server and the
 * worker health server: Pino logger with {@link PINO_REDACT_PATHS} plus recursive
 * `redactSensitive` formatter, `pino-pretty` only in local, `trustProxy` resolved from
 * env (required behind Railway/LB), correlation id propagation from `x-request-id`
 * (accepted only when it matches {@link SAFE_INBOUND_REQUEST_IDENTIFIER_PATTERN}, otherwise a
 * server-side UUID is generated), and the platform body-limit, request-timeout, and
 * connection-timeout defaults.
 */
export function buildFastifyServerOptions(): FastifyServerOptions {
  return {
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [...PINO_REDACT_PATHS],
        censor: '[REDACTED]',
      },
      formatters: {
        log: (object) => redactSensitive(object),
      },
      ...(env.NODE_ENV === 'local'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:standard' },
            },
          }
        : {}),
    },
    trustProxy: resolveTrustProxy(),
    genReqId: (request) => resolveIncomingRequestIdentifier(request),
    bodyLimit: 1_048_576,
    requestTimeout: env.FASTIFY_REQUEST_TIMEOUT_MS ?? THIRTY_SECONDS_MS,
    connectionTimeout: env.FASTIFY_CONNECTION_TIMEOUT_MS ?? 10_000,
  };
}
