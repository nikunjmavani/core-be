import type { FastifyReply, FastifyRequest } from 'fastify';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { getEnv } from '@/shared/config/env.config.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { verifyTurnstileToken } from '@/shared/utils/security/turnstile-verifier.util.js';

function firstHeaderValue(rawHeader: string | string[] | undefined): string | undefined {
  if (rawHeader === undefined || rawHeader === '') {
    return undefined;
  }
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isCaptchaEnforced(): boolean {
  const environment = getEnv();
  return environment.CAPTCHA_PROVIDER === 'turnstile' && Boolean(environment.CAPTCHA_SECRET);
}

function isCaptchaFailOpen(): boolean {
  const nodeEnvironment = getEnv().NODE_ENV;
  return nodeEnvironment === 'test' || nodeEnvironment === 'development';
}

function isCaptchaBypassAllowed(request: FastifyRequest): boolean {
  const environment = getEnv();
  if (environment.NODE_ENV === 'production') {
    return false;
  }
  const bypassHeaderName = environment.CAPTCHA_BYPASS_HEADER;
  if (!bypassHeaderName) {
    return false;
  }
  const bypassValue = firstHeaderValue(
    request.headers[bypassHeaderName.toLowerCase() as keyof typeof request.headers],
  );
  return bypassValue === 'true' || bypassValue === '1';
}

/**
 * Validates Cloudflare Turnstile token from X-Captcha-Token on public auth routes.
 * Skipped when CAPTCHA_PROVIDER=disabled or secret unset (fail-open in dev/test only).
 */
export async function captchaPreHandler(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!isCaptchaEnforced()) {
    if (isCaptchaFailOpen()) {
      return;
    }
    throw new UnauthorizedError('errors:captchaProviderUnavailable');
  }

  if (isCaptchaBypassAllowed(request)) {
    return;
  }

  const captchaToken = firstHeaderValue(request.headers['x-captcha-token']);
  if (!captchaToken) {
    throw new UnauthorizedError('errors:captchaRequired');
  }

  try {
    const result = await verifyTurnstileToken(captchaToken, request.ip);
    if (!result.success) {
      throw new UnauthorizedError('errors:captchaInvalid');
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    if (error instanceof CircuitBreakerOpenError) {
      throw new UnauthorizedError('errors:captchaProviderUnavailable');
    }
    if (isCaptchaFailOpen()) {
      return;
    }
    throw new UnauthorizedError('errors:captchaProviderUnavailable');
  }
}
