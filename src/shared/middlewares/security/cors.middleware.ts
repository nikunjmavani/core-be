import type { FastifyPluginAsync } from 'fastify';
import fastifyCors from '@fastify/cors';
import { env } from '@/shared/config/env.config.js';
import { CORS_PREFLIGHT_MAX_AGE_SECONDS } from '@/shared/constants/index.js';
import { parseAllowedOriginsList } from '@/shared/utils/security/allowed-origins.util.js';

const corsMiddleware: FastifyPluginAsync = async (app) => {
  const origins = parseAllowedOriginsList(env.ALLOWED_ORIGINS);

  if (origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must contain at least one origin');
  }

  await app.register(fastifyCors, {
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Organization-Id',
      'X-Captcha-Token',
      'X-Idempotency-Key',
      'X-Request-Id',
    ],
    // sec-re-17: sec-CM #27 added the server-minted `X-Client-Request-Id`
    // response header but did not list it on `exposedHeaders`. Cross-origin
    // browsers honour `Access-Control-Expose-Headers` strictly, so without
    // this entry the new header was invisible to fetch / XHR callers and
    // the tracing pivot it was meant to enable did not work from web apps.
    //
    // The rate-limit + `Retry-After` headers are exposed for the same reason:
    // a cross-origin SPA cannot read them off a 429/503 otherwise, so it cannot
    // honour the server's backoff directive (it would retry blindly and amplify
    // load during a rate-limit event or while the idempotency store is degraded).
    exposedHeaders: [
      'X-Request-Id',
      'X-Client-Request-Id',
      'X-Idempotency-Replay',
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
  });
};

export default corsMiddleware;
