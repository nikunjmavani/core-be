import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/domains/auth/auth.http.util.js';
import { env } from '@/shared/config/env.config.js';
import { ForbiddenError } from '@/shared/errors/index.js';
import { parseAllowedOriginsList } from '@/shared/utils/security/allowed-origins.util.js';

function firstHeaderValue(rawHeader: string | string[] | undefined): string | undefined {
  if (rawHeader === undefined || rawHeader === '') {
    return undefined;
  }
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertOriginAllowed(origin: string, allowedOriginsList: string[]): void {
  if (!allowedOriginsList.includes(origin)) {
    throw new ForbiddenError('errors:originNotAllowed');
  }
}

function originFromRefererHeader(refererHeader: string): string {
  try {
    return new URL(refererHeader).origin;
  } catch {
    throw new ForbiddenError('errors:invalidRefererOrigin');
  }
}

function requireCsrfDoubleSubmit(request: FastifyRequest): void {
  // eslint-disable-next-line security/detect-object-injection -- CSRF_HEADER_NAME is a constant.
  const headerToken = firstHeaderValue(request.headers[CSRF_HEADER_NAME]);
  // eslint-disable-next-line security/detect-object-injection -- CSRF_COOKIE_NAME is a constant.
  const cookieToken = request.cookies?.[CSRF_COOKIE_NAME];
  if (headerToken === undefined || cookieToken === undefined) {
    throw new ForbiddenError('errors:invalidCsrfToken');
  }
  const headerBuffer = Buffer.from(headerToken);
  const cookieBuffer = Buffer.from(cookieToken);
  if (headerBuffer.length !== cookieBuffer.length || !timingSafeEqual(headerBuffer, cookieBuffer)) {
    throw new ForbiddenError('errors:invalidCsrfToken');
  }
}

/**
 * For routes that authenticate via httpOnly session cookies: when ALLOWED_ORIGINS is configured,
 * require a trusted source origin from the Origin header. In production, when Origin is absent,
 * require CSRF double-submit (X-CSRF-Token header matching csrf_token cookie). Non-production
 * may fall back to Referer origin validation. Empty allowlist skips the check (e.g. some dev setups).
 */
export function requireAllowedSourceOriginForCookieSessionRoute(request: FastifyRequest): void {
  const allowedOriginsList = parseAllowedOriginsList(env.ALLOWED_ORIGINS);
  if (allowedOriginsList.length === 0) {
    return;
  }

  const originHeader = firstHeaderValue(request.headers.origin);
  if (originHeader !== undefined) {
    assertOriginAllowed(originHeader, allowedOriginsList);
    return;
  }

  if (env.NODE_ENV === 'production') {
    requireCsrfDoubleSubmit(request);
    return;
  }

  const refererHeader = firstHeaderValue(request.headers.referer);
  if (refererHeader !== undefined) {
    const refererOrigin = originFromRefererHeader(refererHeader);
    assertOriginAllowed(refererOrigin, allowedOriginsList);
    return;
  }

  throw new ForbiddenError('errors:originNotAllowed');
}

/** @deprecated Use {@link requireAllowedSourceOriginForCookieSessionRoute}. */
export const requireAllowedOriginWhenPresentForCookieSessionRoute =
  requireAllowedSourceOriginForCookieSessionRoute;
