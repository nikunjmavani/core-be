import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { NotImplementedError } from '@/shared/errors/index.js';
import {
  translateMessageKeyPayload,
  type MessageKeyPayload,
} from '@/shared/utils/i18n/i18n-response.util.js';
import { translateRequestMessage } from '@/shared/utils/i18n/translate-request.util.js';
import { env } from '@/shared/config/env.config.js';
import { SECONDS_PER_DAY } from '@/shared/constants/index.js';

/** Name of the httpOnly cookie that carries the opaque session public id used for refresh and auth-route flows. */
export const SESSION_COOKIE_NAME = 'session_id';
/** Name of the non-httpOnly cookie that holds the CSRF token mirrored by the SPA into the {@link CSRF_HEADER_NAME} header (double-submit). */
export const CSRF_COOKIE_NAME = 'csrf_token';
/** Header the SPA mirrors from {@link CSRF_COOKIE_NAME} for double-submit CSRF on cookie auth routes. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Generates a cryptographically random CSRF token (32 bytes, base64url-encoded). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Builds the cookie options used for {@link SESSION_COOKIE_NAME}: httpOnly, sameSite=strict, scoped to `/api/v1/auth`. */
export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: env.AUTH_SESSION_MAX_AGE_DAYS * SECONDS_PER_DAY,
  };
}

/** Builds the cookie options used for {@link CSRF_COOKIE_NAME}: readable by JS (non-httpOnly) so the SPA can echo the token into a request header. */
export function getCsrfCookieOptions() {
  return {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: env.AUTH_SESSION_MAX_AGE_DAYS * SECONDS_PER_DAY,
  };
}

/** Writes the CSRF cookie on `reply`, generating a fresh token when `csrfToken` is omitted. */
export function setCsrfCookie(reply: FastifyReply, csrfToken?: string): void {
  reply.setCookie(CSRF_COOKIE_NAME, csrfToken ?? generateCsrfToken(), getCsrfCookieOptions());
}

/** Removes {@link CSRF_COOKIE_NAME} from the browser (used on logout / session revoke). */
export function clearCsrfCookie(reply: FastifyReply): void {
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/api/v1/auth' });
}

/** Writes the session cookie carrying `sessionPublicId` and simultaneously refreshes the CSRF cookie. */
export function setSessionCookie(reply: FastifyReply, sessionPublicId: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, sessionPublicId, getSessionCookieOptions());
  setCsrfCookie(reply);
}

/** Clears both the session and CSRF cookies (logout flow). */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/api/v1/auth' });
  clearCsrfCookie(reply);
}

/** Returns the request remote IP, falling back to `127.0.0.1` when Fastify has not populated `request.ip`. */
export function getIpAddress(request: FastifyRequest): string {
  return request.ip ?? '127.0.0.1';
}

/** Returns the request `User-Agent` header, or `null` when absent. */
export function getUserAgent(request: FastifyRequest): string | null {
  return request.headers['user-agent'] ?? null;
}

/** Detects "OAuth provider not implemented" errors (status 501, `NotImplementedError`, or a message containing "not supported") so callers can surface a typed 501. */
export function isOauthProviderNotImplementedError(error: unknown): boolean {
  const err = error as Error & { statusCode?: number };
  return (
    error instanceof NotImplementedError ||
    err?.statusCode === 501 ||
    err?.name === 'NotImplementedError' ||
    (err?.message !== undefined && String(err.message).includes('not supported'))
  );
}

/** Reads the request `Origin` header for CSRF-allowlist checks on the refresh endpoint; returns `undefined` for non-browser callers that omit it. */
export function readRequestOrigin(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;
  return typeof origin === 'string' && origin.length > 0 ? origin : undefined;
}

/** Maps auth-method service payloads with optional `messageKey` to translated HTTP bodies. */
export function resolveAuthMessageKeyResponse(
  request: FastifyRequest,
  data: MessageKeyPayload | Record<string, unknown>,
): Record<string, unknown> {
  if (typeof (data as MessageKeyPayload).messageKey === 'string') {
    return translateMessageKeyPayload(request, data as MessageKeyPayload);
  }
  return data;
}

/** Sends a translated 501 response when an OAuth provider has not been wired (used by both the redirect and callback handlers). */
export function sendOauthProviderNotImplementedResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  requestIdentifier: string,
) {
  return reply.status(501).send({
    error: {
      type: 'request_error',
      code: 'not_implemented',
      detail: translateRequestMessage(
        request,
        'errors:notImplemented',
        'Please raise a feature request',
      ),
    },
    meta: { request_id: requestIdentifier },
  });
}
