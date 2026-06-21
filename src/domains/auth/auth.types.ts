/**
 * Magic-link send result.
 *
 * The raw token is intentionally absent — it is dispatched only via
 * `AUTH_EVENT.MAGIC_LINK_REQUESTED` and the resulting email. Tests use
 * `captureNextMagicLinkToken` (src/tests/helpers/magic-link.helper.ts) to read it.
 *
 * `messageKey` is translated by the HTTP handler via `translateMessageKeyPayload`
 * before reaching the API response.
 */
export interface MagicLinkSendResult {
  messageKey: string;
  expires_in_minutes: number;
}
