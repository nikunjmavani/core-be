import { Resend } from 'resend';
import { env } from '@/shared/config/env.config.js';
import {
  CircuitBreakerOpenError,
  resendCircuit,
} from '@/infrastructure/resilience/circuit-breaker.js';
import {
  isTransientNetworkError,
  retryWithBackoff,
} from '@/infrastructure/resilience/retry-with-backoff.util.js';
import { ResendApiError } from '@/infrastructure/mail/resend-api.error.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

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

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

async function sendEmailViaResend(
  options: SendEmailOptions,
  recipientCount: number,
): Promise<string> {
  const fromAddress = env.EMAIL_FROM_ADDRESS ?? 'noreply@albetrios.com';
  const fromName = env.EMAIL_FROM_NAME ?? 'Core';
  const client = getClient();
  const requestOptions: ResendEmailRequestOptions = {
    signal: AbortSignal.timeout(env.RESEND_HTTP_TIMEOUT_MS),
  };
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
 * Send an email via Resend.
 * @throws on transport failure, Resend API error, or open circuit (for BullMQ retry/backoff).
 */
export async function sendEmail(options: SendEmailOptions): Promise<string> {
  const recipientCount = Array.isArray(options.to) ? options.to.length : 1;

  try {
    const result = await resendCircuit.execute(async () =>
      retryWithBackoff(async () => sendEmailViaResend(options, recipientCount), {
        maxAttempts: 3,
        baseDelayMs: 500,
        shouldRetry: (error) =>
          !(error instanceof ResendApiError || error instanceof CircuitBreakerOpenError) &&
          isTransientNetworkError(error),
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
 * Check if mail service is configured and ready to send.
 */
export function isMailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}
