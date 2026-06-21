import { describe, expect, it, vi, beforeEach } from 'vitest';
import { lookup } from 'node:dns/promises';
import { ValidationError } from '@/shared/errors/index.js';
import { validateWebhookUrl } from '@/shared/utils/security/webhook-url.util.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

function mockDnsLookupAll(addresses: Array<{ address: string; family: 4 | 6 }>): void {
  mockedLookup.mockResolvedValue(addresses as unknown as Awaited<ReturnType<typeof lookup>>);
}

describe('webhook-url.util', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it('accepts public HTTPS URL when DNS resolves to public IPv4', async () => {
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);
    await expect(validateWebhookUrl('https://example.com/webhook')).resolves.toBeUndefined();
  });

  it('rejects HTTP URLs even when DNS resolves to public IPv4', async () => {
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);
    await expect(validateWebhookUrl('http://example.com/webhook')).rejects.toThrow(ValidationError);
    await expect(validateWebhookUrl('http://example.com/webhook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlInvalidScheme',
    });
  });

  it('rejects 127.0.0.1 hostname without DNS lookup', async () => {
    await expect(validateWebhookUrl('https://127.0.0.1/hook')).rejects.toThrow(ValidationError);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejects when any resolved address is private', async () => {
    mockDnsLookupAll([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(validateWebhookUrl('https://mixed.example/hook')).rejects.toThrow(ValidationError);
  });

  it('rejects invalid URL format', async () => {
    await expect(validateWebhookUrl('not-a-url')).rejects.toThrow(ValidationError);
    await expect(validateWebhookUrl('not-a-url')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlInvalid',
    });
  });

  it('rejects non-HTTP(S) schemes', async () => {
    await expect(validateWebhookUrl('ftp://example.com/hook')).rejects.toThrow(ValidationError);
    await expect(validateWebhookUrl('ftp://example.com/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlInvalidScheme',
    });
  });

  it('rejects localhost hostname without DNS lookup', async () => {
    await expect(validateWebhookUrl('http://localhost/hook')).rejects.toThrow(ValidationError);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejects hostname resolving to private IPv4', async () => {
    mockDnsLookupAll([{ address: '10.0.0.1', family: 4 }]);
    await expect(validateWebhookUrl('https://internal.example/hook')).rejects.toThrow(
      ValidationError,
    );
  });

  it('rejects hostname resolving to private IPv6', async () => {
    mockDnsLookupAll([{ address: '::1', family: 6 }]);
    await expect(validateWebhookUrl('https://v6.example/hook')).rejects.toThrow(ValidationError);
  });

  it('rejects when DNS lookup fails', async () => {
    mockedLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(validateWebhookUrl('https://missing.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlDnsFailed',
    });
  });

  it('rejects IPv4-mapped IPv6 loopback literal without DNS lookup', async () => {
    await expect(validateWebhookUrl('http://[::ffff:127.0.0.1]/hook')).rejects.toThrow(
      ValidationError,
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped IPv6 loopback in hex form without DNS lookup', async () => {
    await expect(validateWebhookUrl('http://[::ffff:7f00:1]/hook')).rejects.toThrow(
      ValidationError,
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped private IPv4 literal without DNS lookup', async () => {
    await expect(validateWebhookUrl('http://[::ffff:10.0.0.1]/hook')).rejects.toThrow(
      ValidationError,
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped link-local metadata literal without DNS lookup', async () => {
    await expect(validateWebhookUrl('http://[::ffff:169.254.169.254]/hook')).rejects.toThrow(
      ValidationError,
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('accepts public IPv6 literal without DNS lookup', async () => {
    await expect(
      validateWebhookUrl('https://[2001:4860:4860::8888]/hook'),
    ).resolves.toBeUndefined();
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  // audit #10: NAT64 well-known prefix (rfc6052) and IPv4-compatible IPv6 (`::a.b.c.d`) were not in
  // the blocked-range set, so a hostname resolving to one reached internal/loopback IPv4.
  it.each([
    ['64:ff9b::a9fe:a9fe', 'NAT64-embedded cloud metadata 169.254.169.254'],
    ['64:ff9b::7f00:1', 'NAT64-embedded loopback 127.0.0.1'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
    ['::10.0.0.1', 'IPv4-compatible private'],
  ])('rejects a hostname resolving to %s (%s)', async (address) => {
    mockDnsLookupAll([{ address, family: 6 }]);
    await expect(validateWebhookUrl('https://partner.example.com/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });
  });

  it('rejects the NAT64 metadata literal without DNS lookup (audit #10)', async () => {
    await expect(validateWebhookUrl('https://[64:ff9b::a9fe:a9fe]/hook')).rejects.toThrow(
      ValidationError,
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  // audit #9: webhook delivery is HTTPS-only, so 443 is the only legitimate port; any other port
  // turns the platform into an outbound port-prober.
  it('rejects a non-443 destination port even on a public host (audit #9)', async () => {
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);
    await expect(validateWebhookUrl('https://example.com:9200/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });
  });

  it('accepts an explicit :443 and the default port (audit #9)', async () => {
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);
    await expect(validateWebhookUrl('https://example.com:443/hook')).resolves.toBeUndefined();
    await expect(validateWebhookUrl('https://example.com/hook')).resolves.toBeUndefined();
  });
});
