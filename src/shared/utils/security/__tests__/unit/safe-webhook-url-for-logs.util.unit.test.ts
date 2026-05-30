import { describe, expect, it } from 'vitest';
import { safeWebhookUrlForLogs } from '@/shared/utils/security/safe-webhook-url-for-logs.util.js';

describe('safeWebhookUrlForLogs', () => {
  it('strips query strings and credentials from logged webhook URLs', () => {
    const result = safeWebhookUrlForLogs(
      'https://user:pass@hooks.example.com/path/hook?sig=supersecret&token=abc',
    );

    expect(result.webhookOrigin).toBe('https://hooks.example.com');
    expect(result.webhookPath).toBe('/path/hook');
    expect(result.webhookUrlHash).toHaveLength(16);
    expect(JSON.stringify(result)).not.toContain('supersecret');
    expect(JSON.stringify(result)).not.toContain('user:pass');
  });

  it('returns stable hashes for the same URL', () => {
    const url = 'https://hooks.example.com/callback?key=opaque';
    expect(safeWebhookUrlForLogs(url).webhookUrlHash).toBe(
      safeWebhookUrlForLogs(url).webhookUrlHash,
    );
  });
});
