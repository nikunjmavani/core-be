import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyCompress from '@fastify/compress';
import { responseBodyContainsSecretFields } from '@/shared/utils/idempotency/idempotency-fingerprint.util.js';

/** Minimum response size (bytes) before compression is applied (1 KiB). */
const COMPRESSION_THRESHOLD_BYTES = 1024;

const compressMiddlewareInner: FastifyPluginAsync = async (app) => {
  // sec-C/M finding #26 + sec-re-03 fix: BREACH/CRIME defense-in-depth. A future route
  // that returns a server-minted secret alongside an attacker-influenced echo string in
  // the SAME body becomes a side-channel oracle when compressed (the attacker observes
  // the response size to deduce the secret byte-by-byte). Use an `onSend` filter that
  // suppresses compression on any response whose JSON carries a sensitive field name.
  //
  // sec-re-03: the original sec-C/M #26 fix set `x-no-compression: 1` on the *response*,
  // but `@fastify/compress` reads the *inbound request header* of that name — the
  // response-side flag is silently ignored. `removeHeader('content-encoding')` was also
  // a no-op because compress hasn't set `Content-Encoding` yet at this lifecycle point.
  // The BREACH oracle stayed open. The reliable mechanism is to set `Content-Encoding`
  // to a non-`identity` sentinel BEFORE compress's onSend runs: compress short-circuits
  // when `responseEncoding && responseEncoding !== 'identity'`, which keeps the
  // suppression robust regardless of plugin-internal lifecycle quirks.
  // `identity-no-compress` is recognisable in logs and is not a real encoding so
  // downstream consumers won't try to decode.
  //
  // Hook ordering: this `onSend` MUST be registered BEFORE `app.register(fastifyCompress)`
  // because Fastify runs onSend hooks in registration order — by the time compress's hook
  // runs, the payload has been transformed from a string to a Buffer, our `typeof payload
  // !== 'string'` early-return would trigger, and our header would never be set. Running
  // first lets us inspect the string body, set the sentinel encoding, and let compress
  // skip its own work.
  //
  // Cache-control is hardened too: even if a proxy strips the suppression encoding, no
  // cache should retain a secret-bearing body. The detection reuses the same
  // {@link responseBodyContainsSecretFields} matcher that gates idempotency caching
  // (sec-C/M #12) — one source of truth.
  // Fast-path: a cheap substring pre-scan lets the 95%+ of secret-free responses skip the
  // expensive JSON.parse + recursive walk inside {@link responseBodyContainsSecretFields}.
  //
  // INVARIANT — this list MUST remain a *superset* of every fragment the canonical matcher
  // catches; otherwise a secret-bearing body would skip the no-store/no-compress hardening
  // (a BREACH / cache-leak regression). It mirrors, as bare (un-quoted) lowercase substrings:
  //   • SENSITIVE_KEY_FRAGMENTS               (sensitive-redaction.util.ts — `isSensitiveKey`)
  //   • IDEMPOTENCY_SECRET_RESPONSE_FIELD_NAMES (idempotency-fingerprint.util.ts)
  // Bare matching only ever over-triggers (a false positive merely runs the full check), so it
  // cannot produce a false negative. The superset property is pinned by the compress unit test.
  const SECRET_FRAGMENTS = [
    'token', // token, access_token, refresh_token, mfa_session_token
    'secret', // secret, client_secret
    'password',
    'passwd',
    'credential',
    'cookie',
    'jwt',
    'key', // api_key, raw_key, private_key, encryption_key, access_key_id
    'authorization',
    'session', // session_id
    'email',
    'recovery_code', // recovery_codes
    'download_url',
    'upload_url',
  ];
  function likelyContainsSecretFields(body: string): boolean {
    const lower = body.toLowerCase();
    return SECRET_FRAGMENTS.some((fragment) => lower.includes(fragment));
  }

  app.addHook('onSend', async (_request, reply, payload) => {
    if (
      typeof payload === 'string' &&
      likelyContainsSecretFields(payload) &&
      responseBodyContainsSecretFields(payload)
    ) {
      reply.header('cache-control', 'no-store, no-cache, must-revalidate, private');
      reply.header('content-encoding', 'identity-no-compress');
    }
    return payload;
  });

  await app.register(fastifyCompress, {
    global: true,
    threshold: COMPRESSION_THRESHOLD_BYTES, // Only compress responses > 1 KB
    // Brotli is enabled by default in @fastify/compress when the runtime supports it.
    // Prefer brotli for large JSON payloads; gzip remains the fallback for older clients.
    encodings: ['br', 'gzip', 'deflate'],
    // audit #4: disable INBOUND request decompression. In global mode @fastify/compress
    // transparently inflates any request carrying `Content-Encoding: gzip|deflate|br`. The
    // 1 MiB bodyLimit bounds memory but NOT the CPU of the inflate — a ~1 KB body can inflate
    // toward 1 MiB (~1000:1), a cheap CPU-amplification DoS. This API only consumes JSON, so
    // no client needs to send a compressed request body; refuse them outright.
    globalDecompression: false,
  });
};

/**
 * Wrapped in `fastify-plugin` so both the BREACH-suppression `onSend` hook and
 * the `@fastify/compress` registration escape plugin encapsulation and apply
 * to every route in the parent app — same pattern used by
 * `server-timing.middleware.ts`. Without `fp()`, the hooks would only fire
 * for routes registered INSIDE this plugin scope (zero in production), which
 * was a second layer of the sec-re-03 regression.
 */
const compressMiddleware: FastifyPluginAsync = fp(compressMiddlewareInner, {
  name: 'compress-middleware',
});

export default compressMiddleware;
