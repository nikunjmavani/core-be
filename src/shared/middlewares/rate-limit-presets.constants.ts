import type { FastifyRequest } from 'fastify';

/**
 * Per-route rate limit presets for high-risk endpoints.
 * Authenticated presets use hook `preHandler` so `keyGenerator` runs after `app.authenticate`.
 * @see https://github.com/fastify/fastify-rate-limit#custom-hook-example-usage-after-authentication
 */
function buildRateLimitKeyFromIpAddress(request: FastifyRequest): string {
  return `ip:${request.ip}`;
}

function buildRateLimitKeyFromAuthenticatedUserOrIpAddress(request: FastifyRequest): string {
  const userId = request.auth?.userId;
  return userId ? `user:${userId}` : `ip:${request.ip}`;
}

function buildRateLimitKeyFromOrganizationUserOrIpAddress(request: FastifyRequest): string {
  const requestWithOrganization = request as FastifyRequest & { organizationId?: string | null };
  const organizationPublicId = requestWithOrganization.organizationId;
  if (
    organizationPublicId !== undefined &&
    organizationPublicId !== null &&
    organizationPublicId.length > 0
  ) {
    return `organization:${organizationPublicId}`;
  }
  const userId = request.auth?.userId;
  return userId ? `user:${userId}` : `ip:${request.ip}`;
}

const NODE_ENV_FOR_RATE_LIMIT_CAPS = process.env.NODE_ENV;

/**
 * Sensitive public endpoints use a tight cap in production/staging so credentials cannot be brute-forced
 * from a single IPv4 rapidly. Integration tests hammer these routes from loopback in one Vitest file, so lift
 * the ceiling only under NODE_ENV=test to avoid flaky Redis-backed rate-limit waits/timeouts.
 */
const STRICT_PUBLIC_ROUTE_MAX_REQUESTS_PER_WINDOW =
  NODE_ENV_FOR_RATE_LIMIT_CAPS === 'test' ? 5000 : 5;

/** Sensitive public auth-style endpoints — strict cap keyed by IP. */
export const STRICT_PUBLIC_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: STRICT_PUBLIC_ROUTE_MAX_REQUESTS_PER_WINDOW,
      timeWindow: 60_000,
      keyGenerator: buildRateLimitKeyFromIpAddress,
    },
  },
} as const;

const STRICT_AUTHED_MAX_REQUESTS_PER_WINDOW = NODE_ENV_FOR_RATE_LIMIT_CAPS === 'test' ? 5000 : 10;
const MODERATE_AUTHED_MAX_REQUESTS_PER_WINDOW = NODE_ENV_FOR_RATE_LIMIT_CAPS === 'test' ? 5000 : 30;

/**
 * Authenticated credential / abuse-sensitive mutations (10 req / 60s in production), keyed by
 * user when possible. The cap is lifted under NODE_ENV=test so suites that loop through password
 * change / MFA flows from a single loopback IP do not produce flaky 429s.
 */
export const STRICT_AUTHED_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: STRICT_AUTHED_MAX_REQUESTS_PER_WINDOW,
      timeWindow: 60_000,
      hook: 'preHandler' as const,
      keyGenerator: buildRateLimitKeyFromAuthenticatedUserOrIpAddress,
    },
  },
} as const;

/** Moderate cap for authenticated operations that send email or mint URLs (30 req / 60s). */
export const MODERATE_AUTHED_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: MODERATE_AUTHED_MAX_REQUESTS_PER_WINDOW,
      timeWindow: 60_000,
      hook: 'preHandler' as const,
      keyGenerator: buildRateLimitKeyFromAuthenticatedUserOrIpAddress,
    },
  },
} as const;

/** Token refresh (30 req / 60s), keyed by IP — runs on the default hook (onRequest). */
export const REFRESH_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: 60_000,
      keyGenerator: buildRateLimitKeyFromIpAddress,
    },
  },
} as const;

/** Stripe webhook ingress (60 req / 60s per IP) — signature verified but cap abuse. */
export const WEBHOOK_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: NODE_ENV_FOR_RATE_LIMIT_CAPS === 'test' ? 5000 : 60,
      timeWindow: 60_000,
      keyGenerator: buildRateLimitKeyFromIpAddress,
    },
  },
} as const;

/** Organization-scoped mutations (100 req / 60s), keyed by X-Organization-Id when set. */
export const ORGANIZATION_SCOPED_AUTHED_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 100,
      timeWindow: 60_000,
      hook: 'preHandler' as const,
      keyGenerator: buildRateLimitKeyFromOrganizationUserOrIpAddress,
    },
  },
} as const;

/** Expensive operations (5 req / 5 min), keyed by user when possible. */
export const EXPENSIVE_AUTHED_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: 5 * 60_000,
      hook: 'preHandler' as const,
      keyGenerator: buildRateLimitKeyFromAuthenticatedUserOrIpAddress,
    },
  },
} as const;
