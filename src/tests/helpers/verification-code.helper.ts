import { eventBus } from '@/core/events/event-bus.js';
import {
  AUTH_EVENT,
  type EmailVerificationCodePayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';

const DEFAULT_CAPTURE_TIMEOUT_MILLISECONDS = 5_000;

/**
 * Subscribes to `AUTH_EVENT.EMAIL_VERIFICATION_CODE_REQUESTED` and resolves with the raw verification
 * code for the next event matching `email`. The code never appears in the API response (it leaves the
 * service only via this event + the resulting email), so tests read it here.
 *
 * **Call this BEFORE triggering the send** so the handler is registered by the time the event fires
 * (handlers run synchronously inside `eventBus.emit`).
 *
 * @example
 *   const codePromise = captureNextVerificationCode(user.email);
 *   await injectUnauthenticated(app, { method: 'POST', url: '/auth/email/send-code', payload });
 *   const code = await codePromise;
 */
export function captureNextVerificationCode(
  email: string,
  options: { timeoutMilliseconds?: number } = {},
): Promise<string> {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_CAPTURE_TIMEOUT_MILLISECONDS;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `captureNextVerificationCode: timed out after ${timeoutMilliseconds}ms waiting for email=${email}`,
        ),
      );
    }, timeoutMilliseconds);
    timer.unref();

    eventBus.on(AUTH_EVENT.EMAIL_VERIFICATION_CODE_REQUESTED, async (event) => {
      const payload = event.payload as EmailVerificationCodePayload;
      if (payload.email !== email) return;
      clearTimeout(timer);
      resolve(payload.verification_code);
    });
  });
}
