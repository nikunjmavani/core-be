import { Resend } from 'resend';
import { env } from '@/shared/config/env.config.js';
import { CircuitBreakerOpenError } from '@/infrastructure/resilience/circuit-breaker.js';
import { buildOutboundCallOptions, outboundCall } from '@/infrastructure/outbound/index.js';
import { ResendApiError } from '@/infrastructure/mail/resend-api.error.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { isTransientNetworkError } from '@/infrastructure/resilience/retry-with-backoff.util.js';

let resendClient: Resend | null = null;

/** Resend typings omit `signal`, but options are spread into `fetch` (see resend-node post()). */
type ResendEmailRequestOptions = NonNullable<
  Parameters<InstanceType<typeof Resend>['emails']['send']>[1]
> &
  Pick<RequestInit, 'signal'>;

function getClient(): Resend {
  if (resendClient) return resendClient;

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

/**
 * Input for {@link sendEmail} — recipients, rendered HTML body, optional text
 * fallback, reply-to override, and Resend tags for downstream analytics.
 *
 * @remarks
 * - **Algorithm:** consumed by `sendEmailViaResend`, which fans `to` into an array
 *   and forwards `tags`/`replyTo` to the Resend SDK after stripping `undefined`.
 * - **Failure modes:** unset `to`/`subject`/`html` is a schema contract violation;
 *   Resend rejects invalid recipients with `ResendApiError` (not retried).
 * - **Side effects:** none — pure data carrier; persistence happens in
 *   `insertMailOutbox`, transport happens in `sendEmail`.
 * - **Notes:** `requestId` is propagated into Resend retry-context and structured
 *   logs so a single mail can be correlated across HTTP, BullMQ, and Resend logs.
 *   `idempotencyKey` is forwarded to Resend as the `Idempotency-Key` header so a
 *   retried or sweeper-reclaimed send (same outbox row) is de-duplicated by
 *   Resend instead of delivering twice (audit #20).
 */
export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  requestId?: string;
  idempotencyKey?: string;
}

async function sendEmailViaResend(
  options: SendEmailOptions,
  recipientCount: number,
  signal: AbortSignal,
): Promise<string> {
  // No hardcoded sender fallback: env-schema requires EMAIL_FROM_ADDRESS whenever
  // RESEND_API_KEY is set, so reaching here without it is a misconfiguration we surface
  // rather than impersonating an arbitrary domain that Resend would silently reject.
  const fromAddress = env.EMAIL_FROM_ADDRESS;
  if (!fromAddress) {
    throw new Error('EMAIL_FROM_ADDRESS is not configured');
  }
  const fromName = env.EMAIL_FROM_NAME ?? 'Core';
  const client = getClient();
  const requestOptions: ResendEmailRequestOptions = omitUndefined({
    signal,
    idempotencyKey: options.idempotencyKey,
  });
  const sendResult = await client.emails.send(
    omitUndefined({
      from: `${fromName} <${fromAddress}>`,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      tags: options.tags,
    }),
    requestOptions,
  );

  if (sendResult.error) {
    logger.error({ error: sendResult.error, recipientCount }, 'mail.send.failed');
    throw new ResendApiError(
      typeof sendResult.error === 'object' &&
        sendResult.error !== null &&
        'message' in sendResult.error
        ? String((sendResult.error as { message: string }).message)
        : 'resend.api_error',
    );
  }

  const messageId = sendResult.data?.id;
  if (!messageId) {
    throw new ResendApiError('resend.missing_message_id');
  }

  return messageId;
}

/**
 * Sends a single email through Resend behind the shared outbound circuit breaker.
 *
 * @remarks
 * - **Algorithm:** wraps the Resend `emails.send` call in `outboundCall`, which
 *   applies the `resend` circuit breaker + exponential backoff (3 attempts,
 *   500ms base) and forwards an `AbortSignal` so circuit-open or shutdown can
 *   cancel the in-flight HTTP request.
 * - **Failure modes:** `ResendApiError` (4xx / missing `data.id`) is rethrown
 *   without retry; `CircuitBreakerOpenError` propagates so BullMQ retries with
 *   the custom backoff that defers past the circuit cooldown; transient network
 *   errors (`isTransientNetworkError`) trigger the inner retry loop.
 * - **Side effects:** outbound HTTP to Resend; emits `mail.send.success` /
 *   `mail.send.failed` structured logs with recipient count.
 * - **Notes:** treat as the only place that talks to Resend — callers
 *   (mail worker, outbox sweeper retries) supply `requestId` for cross-system
 *   correlation. Returns the Resend message id stored in `mail_outbox.resend_message_id`.
 *
 * @throws on transport failure, Resend API error, or open circuit (for BullMQ retry/backoff).
 */
export async function sendEmail(options: SendEmailOptions): Promise<string> {
  const recipientCount = Array.isArray(options.to) ? options.to.length : 1;

  try {
    const result = await outboundCall(
      buildOutboundCallOptions({
        name: 'resend',
        requestId: options.requestId,
        rethrowIf: (error) => error instanceof ResendApiError,
        retry: {
          maxAttempts: 3,
          baseDelayMs: 500,
          shouldRetry: (error) =>
            !(error instanceof ResendApiError || error instanceof CircuitBreakerOpenError) &&
            isTransientNetworkError(error),
        },
        operation: async (signal) => sendEmailViaResend(options, recipientCount, signal),
      }),
    );

    logger.info({ messageId: result, recipientCount }, 'mail.send.success');
    return result;
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      throw error;
    }
    logger.error({ error, recipientCount }, 'mail.send.exception');
    throw error;
  }
}

/**
 * Reports whether Resend credentials are present so callers can short-circuit
 * mail flows in local/dev environments without raising on missing API key.
 *
 * @remarks
 * - **Algorithm:** boolean check against `env.RESEND_API_KEY`.
 * - **Failure modes:** never throws; environments without Resend should treat
 *   `false` as "skip enqueue" rather than as a hard error.
 * - **Side effects:** none (pure read).
 * - **Notes:** intentionally does NOT validate the key against Resend — only
 *   asserts configuration intent.
 */
export function isMailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}
