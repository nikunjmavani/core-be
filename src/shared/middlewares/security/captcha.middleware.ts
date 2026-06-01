import type { FastifyReply, FastifyRequest } from 'fastify';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { getEnv } from '@/shared/config/env.config.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { verifyTurnstileToken } from '@/shared/utils/security/turnstile-verifier.util.js';

/** Throttle window for the degraded-mode Sentry alert so a captcha-provider outage cannot flood Sentry. */
const CAPTCHA_PROVIDER_UNAVAILABLE_ALERT_INTERVAL_MS = 30_000;
let lastCaptchaProviderUnavailableAlertAtMs = 0;

/**
 * Surfaces the captcha provider (Cloudflare Turnstile) being unavailable as a throttled Sentry
 * event. In production the captcha pre-handler fails closed, so a Turnstile outage blocks every
 * captcha-gated auth route (login, signup, password reset); this makes that page operations rather
 * than only appearing as a spike of 401s. Throttled to one event per
 * {@link CAPTCHA_PROVIDER_UNAVAILABLE_ALERT_INTERVAL_MS} so a sustained outage does not flood Sentry.
 */
function alertCaptchaProviderUnavailable(reason: string): void {
  const now = Date.now();
  if (
    now - lastCaptchaProviderUnavailableAlertAtMs <
    CAPTCHA_PROVIDER_UNAVAILABLE_ALERT_INTERVAL_MS
  ) {
    return;
  }
  lastCaptchaProviderUnavailableAlertAtMs = now;
  captureMessage('captcha.provider_unavailable', { level: 'error', extra: { reason } });
}

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
    alertCaptchaProviderUnavailable('not_configured');
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
    const result = await verifyTurnstileToken({
      token: captchaToken,
      remoteIp: request.ip,
      requestId: request.id,
    });
    if (!result.success) {
      throw new UnauthorizedError('errors:captchaInvalid');
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    if (error instanceof CircuitBreakerOpenError) {
      alertCaptchaProviderUnavailable('breaker_open');
      throw new UnauthorizedError('errors:captchaProviderUnavailable');
    }
    if (isCaptchaFailOpen()) {
      return;
    }
    alertCaptchaProviderUnavailable('verify_error');
    throw new UnauthorizedError('errors:captchaProviderUnavailable');
  }
}
