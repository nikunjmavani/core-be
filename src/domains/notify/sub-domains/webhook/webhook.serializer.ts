/** Secret-bearing fields must never leak in API responses (regression guard). */
const SECRET_FIELDS = ['encrypted_secret', 'secret', 'secret_hash', 'signing_secret'] as const;

function stripWebhookSecrets<T extends Record<string, unknown>>(webhook: T): T {
  return Object.fromEntries(
    Object.entries(webhook).filter(([key]) => !(SECRET_FIELDS as readonly string[]).includes(key)),
  ) as T;
}

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
