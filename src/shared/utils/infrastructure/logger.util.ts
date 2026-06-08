import pino from 'pino';
import { env } from '@/shared/config/env.config.js';
import { PINO_REDACT_PATHS } from '@/shared/utils/http/fastify-server.util.js';
import { redactSensitive } from '@/shared/utils/security/sensitive-redaction.util.js';

/**
 * Process-wide Pino logger pre-configured with sensitive-key redaction
 * (paths + recursive value scrubbing via {@link redactSensitive}). Local dev
 * uses `pino-pretty`; production emits structured JSON for log aggregation.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [...PINO_REDACT_PATHS],
    censor: '[REDACTED]',
  },
  // sec-r5-observability: Pino's default behaviour serialises `Error` objects
  // as `{}` because `name`/`message`/`stack` are non-enumerable. Every
  // `logger.error({ error }, ...)` and `logger.fatal({ error }, ...)` call in
  // the codebase therefore landed in production logs with the actual failure
  // reason dropped. Apply `stdSerializers.err` to both `err` (the pino
  // convention) and `error` (the convention this codebase uses) so every
  // log site benefits without a per-call code change.
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
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
});
