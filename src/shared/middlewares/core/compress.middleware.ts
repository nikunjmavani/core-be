import type { FastifyPluginAsync } from 'fastify';
import fastifyCompress from '@fastify/compress';
import { responseBodyContainsSecretFields } from '@/shared/utils/idempotency/idempotency-fingerprint.util.js';

const compressMiddleware: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCompress, {
    global: true,
    threshold: 1024, // Only compress responses > 1 KB
    // Brotli is enabled by default in @fastify/compress when the runtime supports it.
    // Prefer brotli for large JSON payloads; gzip remains the fallback for older clients.
    encodings: ['br', 'gzip', 'deflate'],
  });

  // sec-C/M finding #26: BREACH/CRIME defense-in-depth. A future route that returns a
  // server-minted secret alongside an attacker-influenced echo string in the SAME body
  // becomes a side-channel oracle when compressed (the attacker observes the response
  // size to deduce the secret byte-by-byte). Pair the global registration with an
  // `onSend` filter that suppresses compression on any response whose JSON carries a
  // sensitive field name. Cache-control is hardened too: even if a proxy strips the
  // suppression header, no cache should retain a secret-bearing body. The detection
  // reuses the same {@link responseBodyContainsSecretFields} matcher that gates
  // idempotency caching (sec-C/M #12) — one source of truth.
  app.addHook('onSend', async (_request, reply, payload) => {
    if (typeof payload !== 'string') return payload;
    if (!responseBodyContainsSecretFields(payload)) return payload;
    reply.header('cache-control', 'no-store, no-cache, must-revalidate, private');
    // Tell @fastify/compress to skip this response — both the explicit
    // `no-compression` flag and the cleared Content-Encoding header keep the
    // suppression robust against future plugin-internal refactors.
    reply.header('x-no-compression', '1');
    reply.removeHeader('content-encoding');
    return payload;
  });
};

export default compressMiddleware;
