/**
 * Email verification-code send result.
 *
 * The raw verification code is intentionally absent — it is dispatched only via
 * `AUTH_EVENT.EMAIL_VERIFICATION_CODE_REQUESTED` and the resulting email. Tests use
 * `captureNextVerificationCode` (src/tests/helpers/verification-code.helper.ts) to read it.
 *
 * `messageKey` is translated by the HTTP handler via `translateMessageKeyPayload`
 * before reaching the API response.
 */
export interface EmailSendCodeResult {
  messageKey: string;
  expires_in_minutes: number;
}
