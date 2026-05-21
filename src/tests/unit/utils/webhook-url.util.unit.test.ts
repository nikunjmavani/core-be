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

  it('accepts public HTTP URL when DNS resolves to public IPv4', async () => {
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);
    await expect(validateWebhookUrl('http://example.com/webhook')).resolves.toBeUndefined();
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
});
