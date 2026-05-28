/** Secret-bearing fields must never leak in API responses (regression guard). */
const SECRET_FIELDS = ['encrypted_secret', 'secret', 'secret_hash', 'signing_secret'] as const;

function stripWebhookSecrets<T extends Record<string, unknown>>(webhook: T): T {
  return Object.fromEntries(
    Object.entries(webhook).filter(([key]) => !(SECRET_FIELDS as readonly string[]).includes(key)),
  ) as T;
}

/**
 * Response serializer for webhook rows that strips every secret-bearing field
 * (`encrypted_secret`, `secret`, `secret_hash`, `signing_secret`) before reaching the client —
 * acts as a regression guard so a future row-shape change cannot accidentally leak signing
 * material in API responses.
 */
export const WebhookSerializer = {
  one<T>(webhook: T): T {
    if (webhook === null || typeof webhook !== 'object') {
      return webhook;
    }
    return stripWebhookSecrets(webhook as Record<string, unknown>) as T;
  },
  many<T>(webhooks: T[]): T[] {
    return webhooks.map((webhook) => WebhookSerializer.one(webhook));
  },
};
