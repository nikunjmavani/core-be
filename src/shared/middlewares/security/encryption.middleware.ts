import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '@/shared/errors/app.error.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { encryptPayload } from '@/shared/utils/security/encryption.util.js';
import { resolveActiveResponseEncryptionKey } from '@/shared/utils/security/response-encryption-keyring.util.js';

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
 * Encrypted envelope: `{ _encrypted: true, kid: "v1", payload: "<base64>", iv: "<base64>", authTag: "<base64>" }`
 * (clients decrypt with Web Crypto AES-GCM; see encryption.util.ts). The `kid` selects which keyring
 * key the client decrypts with, enabling zero-downtime `RESPONSE_ENCRYPTION_KEYS` rotation.
 *
 * Skips:
 *  - Non-API routes (health checks, queue dashboard, static files)
 *  - Routes with `config.raw_response` or `config.skip_encryption`
 *  - Non-JSON content types
 *  - Non-string payloads (streams, buffers, null)
 */
const encryptionMiddleware: FastifyPluginAsync = async (application) => {
  if (!env.ENABLE_RESPONSE_ENCRYPTION) return;

  // Resolve the active write key + its kid once at registration (boot). Throws here — not on the
  // first request — when no key source is configured for the current version or the keyring is
  // malformed, mirroring the field-secret keyring's fail-at-boot contract.
  const { kid, keyHex: encryptionKey } = resolveActiveResponseEncryptionKey();

  logger.info({ kid }, 'Response encryption middleware enabled');

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
        kid,
        payload: encrypted.payload,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      });
    } catch (error) {
      logger.error({ error, url: request.url }, 'Response encryption failed');
      // sec-M8: surface as 503 (transient) instead of 500 (uncategorised
      // server error). The encryption layer's stated purpose is DevTools
      // readability, not anti-attacker hardening — failure should signal the
      // client to retry rather than appear as a permanent server fault. The
      // handler side effects have already committed; an idempotent retry will
      // re-fetch and re-encrypt successfully once whatever transient cause
      // clears (KMS hiccup, key rotation race, etc.).
      if (typeof reply.header === 'function') {
        reply.header('Retry-After', '1');
      }
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'errors:serviceUnavailable');
    }
  });
};

export default encryptionMiddleware;
