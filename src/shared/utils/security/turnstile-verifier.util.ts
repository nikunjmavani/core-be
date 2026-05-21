import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from '@/infrastructure/resilience/circuit-breaker.js';
import { getEnv } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_HTTP_TIMEOUT_MS = 5_000;

export type TurnstileVerifyResult = {
  success: boolean;
  errorCodes?: string[];
};

const turnstileCircuit = new CircuitBreaker({ name: 'turnstile' });

type TurnstileSiteVerifyResponse = {
  success?: boolean;
  'error-codes'?: string[];
};

/**
 * Verifies a Cloudflare Turnstile token via siteverify API.
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string,
): Promise<TurnstileVerifyResult> {
  const secret = getEnv().CAPTCHA_SECRET;
  if (!secret) {
    throw new Error('CAPTCHA_SECRET is not configured');
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  try {
    return await turnstileCircuit.execute(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TURNSTILE_HTTP_TIMEOUT_MS);
      try {
        const response = await fetch(TURNSTILE_VERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: controller.signal,
        });
        const payload = (await response.json()) as TurnstileSiteVerifyResponse;
        const result: TurnstileVerifyResult = { success: payload.success === true };
        const errorCodes = payload['error-codes'];
        if (errorCodes !== undefined) {
          result.errorCodes = errorCodes;
        }
        return result;
      } finally {
        clearTimeout(timeout);
      }
    });
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger.warn({ error }, 'turnstile.circuit.open');
      throw error;
    }
    logger.warn({ error }, 'turnstile.verify.failed');
    throw error;
  }
}
