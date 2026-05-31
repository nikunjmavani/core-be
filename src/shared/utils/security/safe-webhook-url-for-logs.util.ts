import { createHash } from 'node:crypto';

/** Redacted webhook URL fields safe for structured logs and circuit identifiers. */
export interface SafeWebhookUrlForLogs {
  webhookOrigin: string;
  webhookPath: string;
  webhookUrlHash: string;
}

/**
 * Strips query strings, fragments, and credentials from a webhook URL before logging.
 * Returns origin, path, and a stable short hash of the full URL for correlation.
 */
export function safeWebhookUrlForLogs(webhookUrl: string): SafeWebhookUrlForLogs {
  const parsed = new URL(webhookUrl);
  const webhookOrigin = parsed.origin;
  const webhookPath = parsed.pathname.length > 0 ? parsed.pathname : '/';
  const webhookUrlHash = createHash('sha256').update(webhookUrl, 'utf8').digest('hex').slice(0, 16);
  return { webhookOrigin, webhookPath, webhookUrlHash };
}
