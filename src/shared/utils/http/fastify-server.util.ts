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

function resolveTrustProxy(): boolean | number {
  const trustProxy = env.TRUST_PROXY;
  if (trustProxy === false) return false;
  if (trustProxy === true) return true;
  if (typeof trustProxy === 'number') return trustProxy;
  return false;
}

function resolveIncomingRequestIdentifier(incomingMessage: IncomingMessage): string {
  const headerValue = incomingMessage.headers['x-request-id'];
  if (typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue.slice(0, 128);
  }
  if (Array.isArray(headerValue) && headerValue[0] && headerValue[0].length > 0) {
    return headerValue[0].slice(0, 128);
  }
  return randomUUID();
}

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
