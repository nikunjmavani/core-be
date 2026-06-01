import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { buildOutboundCallOptions, outboundCall } from '@/infrastructure/outbound/index.js';
import { getEnv } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Result from {@link verifyTurnstileToken}: `success` plus any error codes Cloudflare returned. */
export type TurnstileVerifyResult = {
  success: boolean;
  errorCodes?: string[];
};

type TurnstileSiteVerifyResponse = {
  success?: boolean;
  'error-codes'?: string[];
};

/** Inputs for {@link verifyTurnstileToken}; `remoteIp` is optional but recommended for Cloudflare's risk scoring. */
export interface VerifyTurnstileTokenOptions {
  token: string;
  remoteIp?: string;
  requestId?: string;
}

/**
 * Verifies a Cloudflare Turnstile token via siteverify API.
 */
export async function verifyTurnstileToken(
  options: VerifyTurnstileTokenOptions,
): Promise<TurnstileVerifyResult> {
  const secret = getEnv().CAPTCHA_SECRET;
  if (!secret) {
    throw new Error('CAPTCHA_SECRET is not configured');
  }

  const body = new URLSearchParams({
    secret,
    response: options.token,
  });
  if (options.remoteIp) {
    body.set('remoteip', options.remoteIp);
  }

  try {
    return await outboundCall(
      buildOutboundCallOptions({
        name: 'captcha-turnstile',
        requestId: options.requestId,
        operation: async (signal) => {
          const response = await fetch(TURNSTILE_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal,
          });
          const payload = (await response.json()) as TurnstileSiteVerifyResponse;
          const result: TurnstileVerifyResult = { success: payload.success === true };
          const errorCodes = payload['error-codes'];
          if (errorCodes !== undefined) {
            result.errorCodes = errorCodes;
          }
          return result;
        },
      }),
    );
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      logger.warn({ error }, 'turnstile.circuit.open');
      throw error;
    }
    logger.warn({ error }, 'turnstile.verify.failed');
    throw error;
  }
}
