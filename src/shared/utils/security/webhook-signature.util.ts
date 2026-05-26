import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 signature for outbound webhook payloads (`timestamp.payload` convention).
 */
export function signWebhookPayload(secret: string, payload: string, timestamp: number): string {
  const signedPayload = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(signedPayload).digest('hex');
}

/** Builds the `X-Webhook-Signature` header value: `t=<timestamp>,v1=<signature>`. */
export function buildWebhookSignatureHeader(
  secret: string,
  payload: string,
  timestamp: number,
): string {
  return `t=${timestamp},v1=${signWebhookPayload(secret, payload, timestamp)}`;
}

/**
 * Constant-time verification of a hex signature from {@link signWebhookPayload}.
 */
export function verifyWebhookPayloadSignature(
  secret: string,
  payload: string,
  timestamp: number,
  signatureHex: string,
): boolean {
  const expectedHex = signWebhookPayload(secret, payload, timestamp);
  if (expectedHex.length !== signatureHex.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}
