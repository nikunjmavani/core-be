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
import { OAUTH_STATE_TTL_SECONDS } from '@/shared/constants/ttl.constants.js';

/** Name of the httpOnly cookie that carries the opaque session public id used for refresh and auth-route flows. */
export const SESSION_COOKIE_NAME = 'session_id';
/** Name of the non-httpOnly cookie that holds the CSRF token mirrored by the SPA into the {@link CSRF_HEADER_NAME} header (double-submit). */
export const CSRF_COOKIE_NAME = 'csrf_token';
/** Header the SPA mirrors from {@link CSRF_COOKIE_NAME} for double-submit CSRF on cookie auth routes. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Cookie path scoping the session + CSRF cookies to the auth API surface (`/api/v1/auth`). */
const SESSION_COOKIE_PATH = '/api/v1/auth';
/** Cookie path scoping the OAuth nonce cookie to the OAuth callback surface (`/api/v1/auth/oauth`). */
const OAUTH_COOKIE_PATH = '/api/v1/auth/oauth';

/** Generates a cryptographically random CSRF token (32 bytes, base64url-encoded). */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Builds the cookie options used for {@link SESSION_COOKIE_NAME}: httpOnly, sameSite from COOKIE_SAMESITE, scoped to `/api/v1/auth`. */
export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    // Configurable so a cross-site SPA can opt into `none`; see COOKIE_SAMESITE in env-schema.
    sameSite: env.COOKIE_SAMESITE,
    path: SESSION_COOKIE_PATH,
    maxAge: env.AUTH_SESSION_MAX_AGE_DAYS * SECONDS_PER_DAY,
  };
}

/** Builds the cookie options used for {@link CSRF_COOKIE_NAME}: readable by JS (non-httpOnly) so the SPA can echo the token into a request header. */
export function getCsrfCookieOptions() {
  return {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    // Must track the session cookie: the SPA echoes this value back as the CSRF header, so a
    // stricter SameSite here would silently break double-submit on cross-site requests.
    sameSite: env.COOKIE_SAMESITE,
    path: SESSION_COOKIE_PATH,
    maxAge: env.AUTH_SESSION_MAX_AGE_DAYS * SECONDS_PER_DAY,
  };
}

/** Writes the CSRF cookie on `reply`, generating a fresh token when `csrfToken` is omitted. */
export function setCsrfCookie(reply: FastifyReply, csrfToken?: string): void {
  reply.setCookie(CSRF_COOKIE_NAME, csrfToken ?? generateCsrfToken(), getCsrfCookieOptions());
}

/** Removes {@link CSRF_COOKIE_NAME} from the browser (used on logout / session revoke). */
export function clearCsrfCookie(reply: FastifyReply): void {
  // Same attributes as the set: a clear is itself a Set-Cookie, and at `SameSite=none` a clear
  // that omits it defaults to Lax and is dropped by the browser in the cross-site context —
  // leaving a credential-shaped value in the jar after logout.
  reply.clearCookie(CSRF_COOKIE_NAME, getCsrfCookieOptions());
}

/** Separator between session public id and refresh secret in {@link SESSION_COOKIE_NAME}. */
const SESSION_COOKIE_SEPARATOR = '.';

/** Generates a cryptographically random refresh secret (32 bytes, base64url-encoded). */
export function generateRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Builds the opaque session cookie value: `<sessionPublicId>.<refreshSecret>`. */
export function formatSessionCookieValue(sessionPublicId: string, refreshSecret: string): string {
  return `${sessionPublicId}${SESSION_COOKIE_SEPARATOR}${refreshSecret}`;
}

/** Parses {@link SESSION_COOKIE_NAME}; returns null for legacy session-id-only cookies. */
export function parseSessionCookieValue(
  rawValue: string,
): { sessionPublicId: string; refreshSecret: string } | null {
  const separatorIndex = rawValue.indexOf(SESSION_COOKIE_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }
  const sessionPublicId = rawValue.slice(0, separatorIndex);
  const refreshSecret = rawValue.slice(separatorIndex + 1);
  if (sessionPublicId.length === 0 || refreshSecret.length === 0) {
    return null;
  }
  return { sessionPublicId, refreshSecret };
}

/** Writes the session cookie carrying `sessionPublicId` and simultaneously refreshes the CSRF cookie. */
export function setSessionCookie(
  reply: FastifyReply,
  sessionPublicId: string,
  refreshSecret: string,
): void {
  reply.setCookie(
    SESSION_COOKIE_NAME,
    formatSessionCookieValue(sessionPublicId, refreshSecret),
    getSessionCookieOptions(),
  );
  setCsrfCookie(reply);
}

/** Clears both the session and CSRF cookies (logout flow). */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, getSessionCookieOptions());
  clearCsrfCookie(reply);
}

/** Name of the short-lived httpOnly cookie that binds an OAuth callback to the browser that started the authorize flow. */
export const OAUTH_NONCE_COOKIE_NAME = 'oauth_nonce';

/**
 * Builds cookie options for {@link OAUTH_NONCE_COOKIE_NAME}: httpOnly, `sameSite=lax` so the
 * cookie survives the top-level navigation back from the provider, scoped to the OAuth callback
 * path, and expiring with the Redis `state` TTL.
 */
/**
 * `SameSite` for the OAuth nonce cookie. Never `strict` — that would block the cookie on the
 * provider's top-level redirect back to us. But `lax` is not enough either when the SPA is
 * cross-site: this cookie is SET on the response to a cross-site `fetch` (the SPA calls
 * `GET /auth/oauth/:provider` via XHR), and per RFC 6265bis a browser IGNORES a non-`none`
 * cookie arriving in that context. It is never stored, so the callback reads no nonce and
 * `consumeOAuthState` fails closed with 401 — availability, never a login-CSRF bypass.
 */
function getOauthNonceSameSite(): 'none' | 'lax' {
  return env.COOKIE_SAMESITE === 'none' ? 'none' : 'lax';
}

/** Cookie attributes for the OAuth nonce cookie — shared by the set and clear paths so they always match (a `clearCookie` only lands when `path` and `sameSite` are identical). */
export function getOauthNonceCookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: getOauthNonceSameSite(),
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_STATE_TTL_SECONDS,
  };
}

/** Writes the OAuth nonce cookie on `reply` so the matching callback can prove same-browser origin. */
export function setOauthNonceCookie(reply: FastifyReply, nonce: string): void {
  reply.setCookie(OAUTH_NONCE_COOKIE_NAME, nonce, getOauthNonceCookieOptions());
}

/** Reads the OAuth nonce cookie from the request, returning `undefined` when absent. */
export function readOauthNonceCookie(request: FastifyRequest): string | undefined {
  const nonce = request.cookies?.[OAUTH_NONCE_COOKIE_NAME];
  return typeof nonce === 'string' && nonce.length > 0 ? nonce : undefined;
}

/** Removes the OAuth nonce cookie (called after the callback consumes it). */
export function clearOauthNonceCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_NONCE_COOKIE_NAME, getOauthNonceCookieOptions());
}

/** Returns the request remote IP, falling back to `127.0.0.1` when Fastify has not populated `request.ip`. */
export function getIpAddress(request: FastifyRequest): string {
  return request.ip ?? '127.0.0.1';
}

/** Max bytes stored for `user_agent` — matches the `varchar(512)` DB column. */
const USER_AGENT_MAX_LENGTH = 512;

/** Returns the request `User-Agent` header truncated to {@link USER_AGENT_MAX_LENGTH} characters, or `null` when absent. */
export function getUserAgent(request: FastifyRequest): string | null {
  const raw = request.headers['user-agent'];
  if (!raw) return null;
  return raw.length > USER_AGENT_MAX_LENGTH ? raw.slice(0, USER_AGENT_MAX_LENGTH) : raw;
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
