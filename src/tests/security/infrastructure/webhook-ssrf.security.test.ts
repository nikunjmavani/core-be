import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

/**
 * SSRF protections for outbound webhook delivery (mocked DNS — no external resolver).
 */
describe('Security: Webhook URL SSRF', () => {
  afterEach(() => {
    vi.resetModules();
    mockedLookup.mockReset();
  });

  it('blocks hostnames resolving to private IPv4 (metadata / RFC1918)', async () => {
    mockedLookup.mockResolvedValue([
      { address: '169.254.169.254', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);
    const { assertWebhookUrlSafe } = await import('@/shared/utils/security/webhook-url.util.js');
    await expect(assertWebhookUrlSafe('https://metadata.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });
  });

  it('blocks DNS rebinding targets at delivery pin time via single-resolve pinned fetch', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);
    mockedLookup.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }] as unknown as Awaited<
      ReturnType<typeof lookup>
    >);

    const { resolveAndPinWebhookUrl } = await import(
      '@/shared/utils/security/webhook-outbound-fetch.util.js'
    );
    const firstPin = await resolveAndPinWebhookUrl('https://partner.example/hook');
    expect(firstPin.pinnedAddress).toBe('93.184.216.34');

    await expect(resolveAndPinWebhookUrl('https://partner.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });
  });

  // Private/internal IPv6 forms must all be blocked — these are classic SSRF
  // filter bypasses (loopback, ULA, link-local, unspecified, IPv4-mapped, multicast).
  it.each([
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'IPv6 unique-local (ULA)'],
    ['fd12:3456:789a::1', 'IPv6 unique-local (ULA)'],
    ['fe80::1', 'IPv6 link-local'],
    ['::', 'IPv6 unspecified'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:169.254.169.254', 'IPv4-mapped cloud metadata'],
    ['ff02::1', 'IPv6 multicast'],
  ])('blocks a hostname resolving to %s (%s)', async (address) => {
    mockedLookup.mockResolvedValue([{ address, family: 6 }] as unknown as Awaited<
      ReturnType<typeof lookup>
    >);
    const { assertWebhookUrlSafe } = await import('@/shared/utils/security/webhook-url.util.js');
    await expect(assertWebhookUrlSafe('https://partner.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });
  });

  it('blocks a hostname that resolves to a mix of public and private addresses', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '::1', family: 6 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);
    const { assertWebhookUrlSafe } = await import('@/shared/utils/security/webhook-url.util.js');
    await expect(assertWebhookUrlSafe('https://partner.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });
  });
});
