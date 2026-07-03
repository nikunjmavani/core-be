import type { FastifyReply, FastifyRequest } from 'fastify';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import {
  addSentryBreadcrumb,
  captureMessage,
} from '@/infrastructure/observability/sentry/sentry.js';
import { getEnv } from '@/shared/config/env.config.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import { verifyTurnstileToken } from '@/shared/utils/security/turnstile-verifier.util.js';

/** Throttle window for outage-class Sentry alerts so a sustained Turnstile outage cannot flood Sentry. */
const CAPTCHA_PROVIDER_UNAVAILABLE_ALERT_INTERVAL_MS = 30_000;
let lastCaptchaProviderUnavailableAlertAtMs = 0;

/** Reasons the captcha pre-handler may surface to Sentry. */
type CaptchaUnavailableReason = 'not_configured' | 'breaker_open' | 'verify_error';

/**
 * Surfaces the captcha provider (Cloudflare Turnstile) being unavailable as a Sentry event.
 *
 * @remarks
 * sec-C/M finding #16: the throttle is now reason-specific. The 30-second window is intended
 * for outage-class signals (`breaker_open`, `verify_error`) — a Turnstile outage that floods
 * Sentry once per minute is preferable to one event per request. Misconfiguration
 * (`not_configured`) is a different beast: there is no other observable signal beyond the
 * 401 spike, and the env-schema refine is supposed to prevent it from ever reaching
 * production. We still emit a throttled `captureMessage` for visibility, but ADDITIONALLY
 * emit a per-request breadcrumb so every blocked login is correlatable in the trace timeline
 * once an operator opens the case — without flooding `captureMessage` itself.
 */
function alertCaptchaProviderUnavailable(reason: CaptchaUnavailableReason): void {
  if (reason === 'not_configured') {
    // Per-request breadcrumb (cheap, no rate limit) for forensic visibility.
    addSentryBreadcrumb({
      category: 'captcha',
      message: 'captcha.provider_unavailable.not_configured',
      level: 'error',
    });
  }
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
  // Staging intentionally fails open so that a missing CAPTCHA config does not block auth in
  // non-production environments. Staging is also protected by the env-schema enforcement that
  // requires CAPTCHA_PROVIDER=turnstile when NODE_ENV=staging, so the fail-open path is only
  // reached when a staging instance is intentionally running without CAPTCHA.
  return (
    nodeEnvironment === 'local' ||
    nodeEnvironment === 'test' ||
    nodeEnvironment === 'development' ||
    nodeEnvironment === 'staging'
  );
}

function isCaptchaBypassAllowed(request: FastifyRequest): boolean {
  const environment = getEnv();
  // sec-M3: previously only refused bypass in production; staging accepted it.
  // If staging ever receives real traffic (DNS misconfig, blue/green slot
  // mix-up) credential-stuffing protection collapses. Treat staging the same
  // as production — bypass is a dev/test affordance only.
  if (environment.NODE_ENV === 'production' || environment.NODE_ENV === 'staging') {
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
