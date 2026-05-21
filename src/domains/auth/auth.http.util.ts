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

export const SESSION_COOKIE_NAME = 'session_id';
export const CSRF_COOKIE_NAME = 'csrf_token';
/** Header the SPA mirrors from {@link CSRF_COOKIE_NAME} for double-submit CSRF on cookie auth routes. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export function getSessionCookieOptions() {
  const useSecureCookie = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
  return {
    httpOnly: true,
    secure: useSecureCookie,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: env.SESSION_MAX_AGE_DAYS * SECONDS_PER_DAY,
  };
}

export function getCsrfCookieOptions() {
  const useSecureCookie = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
  return {
    httpOnly: false,
    secure: useSecureCookie,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    maxAge: env.SESSION_MAX_AGE_DAYS * SECONDS_PER_DAY,
  };
}

export function setCsrfCookie(reply: FastifyReply, csrfToken?: string): void {
  reply.setCookie(CSRF_COOKIE_NAME, csrfToken ?? generateCsrfToken(), getCsrfCookieOptions());
}

export function clearCsrfCookie(reply: FastifyReply): void {
  reply.clearCookie(CSRF_COOKIE_NAME, { path: '/api/v1/auth' });
}

export function setSessionCookie(reply: FastifyReply, sessionPublicId: string): void {
  reply.setCookie(SESSION_COOKIE_NAME, sessionPublicId, getSessionCookieOptions());
  setCsrfCookie(reply);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: '/api/v1/auth' });
  clearCsrfCookie(reply);
}

export function getIpAddress(request: FastifyRequest): string {
  return request.ip ?? '127.0.0.1';
}

export function getUserAgent(request: FastifyRequest): string | null {
  return request.headers['user-agent'] ?? null;
}

export function isOauthProviderNotImplementedError(error: unknown): boolean {
  const err = error as Error & { statusCode?: number };
  return (
    error instanceof NotImplementedError ||
    err?.statusCode === 501 ||
    err?.name === 'NotImplementedError' ||
    (err?.message !== undefined && String(err.message).includes('not supported'))
  );
}

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
