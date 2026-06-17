import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import fastifyHelmet from '@fastify/helmet';
import { env } from '@/shared/config/env.config.js';
import { SECONDS_PER_DAY } from '@/shared/constants/ttl.constants.js';

/** HSTS `max-age` (seconds): one year — the standard, preload-eligible duration. */
const HSTS_MAX_AGE_SECONDS = 365 * SECONDS_PER_DAY;

const helmetMiddleware: FastifyPluginAsync = async (app) => {
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // sec-M5: HSTS `preload: true` and `includeSubDomains: true` are
    // operationally irreversible (removal from the HSTS preload list takes
    // weeks; locking every subdomain to HTTPS forever is a major commitment).
    // Gate both behind explicit operator opt-in via env so only deployments
    // that have actually registered + audited use them. The base maxAge +
    // strict-origin-when-cross-origin referrer policy give the standard
    // HSTS protection without those traps.
    hsts: {
      maxAge: HSTS_MAX_AGE_SECONDS,
      includeSubDomains: env.HSTS_INCLUDE_SUBDOMAINS,
      preload: env.HSTS_PRELOAD_REGISTERED,
    },
    noSniff: true,
    xssFilter: true,
  });
};

export default fp(helmetMiddleware, { name: 'helmet-middleware' });
