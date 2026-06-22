import { eventBus } from '@/core/events/event-bus.js';
import {
  AUTH_EVENT,
  type MagicLinkEmailPayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';

const DEFAULT_CAPTURE_TIMEOUT_MILLISECONDS = 5_000;

/**
 * Subscribes to `AUTH_EVENT.MAGIC_LINK_REQUESTED` and resolves with the raw 6-digit sign-in code
 * for the next event matching `email`. The code never appears in the API response (it leaves the
 * service only via this event + the resulting email), so tests read it here.
 *
 * **Call this BEFORE triggering the magic-link send** so the handler is registered by the time the
 * event fires (handlers run synchronously inside `eventBus.emit`).
 *
 * @example
 *   const codePromise = captureNextMagicLinkCode(user.email);
 *   await injectUnauthenticated(app, { method: 'POST', url: '/auth/magic-link/send', payload });
 *   const code = await codePromise;
 */
export function captureNextMagicLinkCode(
  email: string,
  options: { timeoutMilliseconds?: number } = {},
): Promise<string> {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_CAPTURE_TIMEOUT_MILLISECONDS;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `captureNextMagicLinkCode: timed out after ${timeoutMilliseconds}ms waiting for email=${email}`,
        ),
      );
    }, timeoutMilliseconds);
    timer.unref();

    eventBus.on(AUTH_EVENT.MAGIC_LINK_REQUESTED, async (event) => {
      const payload = event.payload as MagicLinkEmailPayload;
      if (payload.email !== email) return;
      clearTimeout(timer);
      resolve(payload.otp_code);
    });
  });
}
