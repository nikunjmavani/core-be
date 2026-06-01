import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '@/shared/errors/app.error.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { encryptPayload } from '@/shared/utils/security/encryption.util.js';

interface RouteConfig {
  raw_response?: boolean;
  skip_encryption?: boolean;
}

const API_PATH_PREFIX = '/api/';

/**
 * AES-256-GCM response encryption middleware.
 *
 * When enabled via ENABLE_RESPONSE_ENCRYPTION, all JSON responses under /api/
 * are encrypted so they appear as unreadable ciphertext in Chrome DevTools.
 *
 * Encrypted envelope: `{ _encrypted: true, payload: "<base64>", iv: "<base64>", authTag: "<base64>" }`
 * (clients decrypt with Web Crypto AES-GCM; see encryption.util.ts).
 *
 * Skips:
 *  - Non-API routes (health checks, queue dashboard, static files)
 *  - Routes with `config.raw_response` or `config.skip_encryption`
 *  - Non-JSON content types
 *  - Non-string payloads (streams, buffers, null)
 */
const encryptionMiddleware: FastifyPluginAsync = async (application) => {
  if (!env.ENABLE_RESPONSE_ENCRYPTION) return;

  if (!env.RESPONSE_ENCRYPTION_KEY) {
    throw new Error(
      'RESPONSE_ENCRYPTION_KEY is required when ENABLE_RESPONSE_ENCRYPTION is enabled',
    );
  }

  const encryptionKey = env.RESPONSE_ENCRYPTION_KEY;

  logger.info('Response encryption middleware enabled');

  application.addHook('onSend', async (request, reply, payload) => {
    if (!request.url.startsWith(API_PATH_PREFIX)) return payload;

    const config = (reply.routeOptions?.config ?? {}) as RouteConfig;
    if (config.raw_response || config.skip_encryption) return payload;

    const contentType = reply.getHeader('content-type');
    if (typeof contentType !== 'string' || !contentType.includes('application/json')) {
      return payload;
    }

    if (typeof payload !== 'string') return payload;

    try {
      const encrypted = encryptPayload(payload, encryptionKey);
      return JSON.stringify({
        _encrypted: true,
        payload: encrypted.payload,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      });
    } catch (error) {
      logger.error({ error, url: request.url }, 'Response encryption failed');
      throw new AppError('INTERNAL_ERROR', 500, 'errors:internal');
    }
  });
};

export default encryptionMiddleware;
