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
      'Idempotency-Key',
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'X-Idempotency-Replay'],
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
  });
};

export default corsMiddleware;
