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
