import type { FastifyRequest } from 'fastify';
import type { RateLimitOptions } from '@fastify/rate-limit';
import { Sentry } from '@/infrastructure/observability/sentry/sentry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Per-route rate limit presets for high-risk endpoints.
 * Authenticated presets use hook `preHandler` so `keyGenerator` runs after `app.authenticate`.
 * @see https://github.com/fastify/fastify-rate-limit#custom-hook-example-usage-after-authentication
 */
function buildRateLimitKeyFromIpAddress(request: FastifyRequest): string {
  return `ip:${request.ip}`;
}

/**
 * Shared `onExceeding` observer wired into every preset below so a throttled per-email / per-user /
 * per-org request surfaces its bucket key. Emits the same structured `rate_limit.exceeded` warning
 * as the global limiter plus a warning-level Sentry breadcrumb for trace context. Observe-only — it
 * never changes throttling behavior. Matches the `onExceeding` signature `(request, key)`.
 */
function recordRouteRateLimitExceeded(request: FastifyRequest, key: string): void {
  const url = request.routeOptions?.url ?? request.url;
  logger.warn({
    event: 'rate_limit.exceeded',
    ip: request.ip,
    method: request.method,
    url,
    key,
  });
  Sentry.addBreadcrumb({
    category: 'rate_limit',
    message: `Rate limit exceeded: ${key}`,
    level: 'warning',
    data: {
      method: request.method,
      url,
      ip: request.ip,
    },
  });
}

/**
 * Derives a stable per-identity rate-limit key from the normalized email in the request body.
 * Falls back to the caller IP when no email is present (e.g. malformed body that still reaches
 * the limiter), so the bucket is never globally shared.
 */
function buildRateLimitKeyFromRequestBodyEmail(request: FastifyRequest): string {
  const body = request.body as { email?: unknown } | undefined;
  const rawEmail = body?.email;
  if (typeof rawEmail === 'string') {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    if (normalizedEmail.length > 0) {
      return `email:${normalizedEmail}`;
    }
  }
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
      onExceeding: recordRouteRateLimitExceeded,
    },
  },
} as const;

/**
 * Per-identity cap (5 requests / 15 min per normalized email in production) for unauthenticated
 * credential and outbound-email endpoints (login, magic-link request, password-reset request).
 * The IP-only {@link STRICT_PUBLIC_RATE_LIMIT} is spoofable, so this complements it by binding the
 * limit to the targeted account/email — blunting credential stuffing, account enumeration, and
 * mailbomb abuse even when CAPTCHA is acknowledged-disabled in production. Lifted under
 * NODE_ENV=test so loopback suites that loop these routes do not produce flaky 429s.
 */
const STRICT_PUBLIC_PER_EMAIL_MAX_REQUESTS_PER_WINDOW =
  NODE_ENV_FOR_RATE_LIMIT_CAPS === 'test' ? 5000 : 5;
const STRICT_PUBLIC_PER_EMAIL_WINDOW_MS = 15 * 60_000;

/**
 * Options for an `app.rateLimit(...)` preHandler that throttles per normalized email/identity,
 * independent of IP. Pass to `app.rateLimit(...)` and add the returned hook to a route's
 * `preHandler` array; keying happens at `preHandler` so the validated body is available.
 */
export const STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS: RateLimitOptions = {
  max: STRICT_PUBLIC_PER_EMAIL_MAX_REQUESTS_PER_WINDOW,
  timeWindow: STRICT_PUBLIC_PER_EMAIL_WINDOW_MS,
  hook: 'preHandler',
  keyGenerator: buildRateLimitKeyFromRequestBodyEmail,
  onExceeding: recordRouteRateLimitExceeded,
};

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
      onExceeding: recordRouteRateLimitExceeded,
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
      onExceeding: recordRouteRateLimitExceeded,
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
      onExceeding: recordRouteRateLimitExceeded,
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
      onExceeding: recordRouteRateLimitExceeded,
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
      onExceeding: recordRouteRateLimitExceeded,
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
      onExceeding: recordRouteRateLimitExceeded,
    },
  },
} as const;
