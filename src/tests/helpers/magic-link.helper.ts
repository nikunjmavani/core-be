import { eventBus } from '@/core/events/event-bus.js';
import {
  AUTH_EVENT,
  type MagicLinkEmailPayload,
} from '@/domains/auth/sub-domains/auth-method/events/auth.events.js';

const DEFAULT_CAPTURE_TIMEOUT_MILLISECONDS = 5_000;

/**
 * Subscribes to `AUTH_EVENT.MAGIC_LINK_REQUESTED` and resolves with the raw token
 * for the next event matching `email`. Replaces the deprecated inline-token leak
 * (`response.body.data.token`) that previously exposed the magic-link token in
 * non-production API responses.
 *
 * **Call this BEFORE triggering the magic-link send** so the handler is registered
 * by the time the event fires (handlers run synchronously inside `eventBus.emit`).
 *
 * @example
 *   const tokenPromise = captureNextMagicLinkToken(user.email);
 *   await injectUnauthenticated(app, { method: 'POST', url: '/auth/magic-link/send', payload });
 *   const rawToken = await tokenPromise;
 */
export function captureNextMagicLinkToken(
  email: string,
  options: { timeoutMilliseconds?: number } = {},
): Promise<string> {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? DEFAULT_CAPTURE_TIMEOUT_MILLISECONDS;
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `captureNextMagicLinkToken: timed out after ${timeoutMilliseconds}ms waiting for email=${email}`,
        ),
      );
    }, timeoutMilliseconds);
    timer.unref();

    eventBus.on(AUTH_EVENT.MAGIC_LINK_REQUESTED, async (event) => {
      const payload = event.payload as MagicLinkEmailPayload;
      if (payload.email !== email) return;
      clearTimeout(timer);
      resolve(payload.magic_link_token);
    });
  });
}
