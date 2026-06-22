import { describe, expect, it, vi, beforeEach } from 'vitest';
import { lookup } from 'node:dns/promises';
import { ValidationError } from '@/shared/errors/index.js';
import { validateWebhookUrl } from '@/shared/utils/security/webhook-url.util.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);

function mockResolvedAddresses(addresses: Array<{ address: string; family: 4 | 6 }>): void {
  mockedLookup.mockResolvedValue(addresses as unknown as Awaited<ReturnType<typeof lookup>>);
}

describe('webhook service SSRF guard (validateWebhookUrl)', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it('createWebhook rejects URLs pointing to localhost/127.0.0.1', async () => {
    await expect(validateWebhookUrl('https://localhost/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(validateWebhookUrl('http://127.0.0.1/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(validateWebhookUrl('http://0.0.0.0/hook')).rejects.toBeInstanceOf(ValidationError);
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('R13: rejects URLs with embedded userinfo (https://user:pass@host) before any DNS lookup', async () => {
    await expect(validateWebhookUrl('https://user:pass@example.com/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(validateWebhookUrl('https://user@example.com/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Credentials are rejected pre-resolution, so DNS is never reached.
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('createWebhook rejects URLs pointing to RFC1918 private IPs', async () => {
    mockResolvedAddresses([{ address: '10.0.0.5', family: 4 }]);
    await expect(validateWebhookUrl('https://internal-10.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });

    mockResolvedAddresses([{ address: '172.16.5.5', family: 4 }]);
    await expect(validateWebhookUrl('https://internal-172.example/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );

    mockResolvedAddresses([{ address: '192.168.1.10', family: 4 }]);
    await expect(validateWebhookUrl('https://internal-192.example/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('createWebhook rejects URLs pointing to link-local addresses', async () => {
    mockResolvedAddresses([{ address: '169.254.169.254', family: 4 }]);
    await expect(validateWebhookUrl('https://metadata.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });

    mockResolvedAddresses([{ address: 'fe80::1', family: 6 }]);
    await expect(validateWebhookUrl('https://v6-link-local.example/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('createWebhook rejects IPv4-mapped IPv6 pointing at cloud metadata (::ffff:169.254.169.254)', async () => {
    mockResolvedAddresses([{ address: '::ffff:169.254.169.254', family: 6 }]);
    await expect(validateWebhookUrl('https://mapped-metadata.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });

    mockResolvedAddresses([{ address: '::ffff:127.0.0.1', family: 6 }]);
    await expect(validateWebhookUrl('https://mapped-loopback.example/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );

    mockResolvedAddresses([{ address: '::ffff:10.0.0.1', family: 6 }]);
    await expect(validateWebhookUrl('https://mapped-private.example/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('createWebhook rejects CGNAT (100.64.0.0/10) and 0.0.0.0/8 resolved IPs', async () => {
    mockResolvedAddresses([{ address: '100.64.0.1', family: 4 }]);
    await expect(validateWebhookUrl('https://cgnat.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });

    mockResolvedAddresses([{ address: '0.0.0.5', family: 4 }]);
    await expect(validateWebhookUrl('https://zero-net.example/hook')).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('createWebhook still accepts an IPv4-mapped IPv6 pointing at a public IP', async () => {
    mockResolvedAddresses([{ address: '::ffff:93.184.216.34', family: 6 }]);
    await expect(validateWebhookUrl('https://mapped-public.example/hook')).resolves.toBeUndefined();
  });

  it('createWebhook accepts public HTTPS URLs resolving to public IPv4', async () => {
    mockResolvedAddresses([{ address: '93.184.216.34', family: 4 }]);
    await expect(validateWebhookUrl('https://example.com/hook')).resolves.toBeUndefined();
    expect(mockedLookup).toHaveBeenCalledWith('example.com', { all: true });
  });

  it('createWebhook rejects non-HTTP(S) schemes before DNS lookup', async () => {
    await expect(validateWebhookUrl('ftp://example.com/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlInvalidScheme',
    });
    expect(mockedLookup).not.toHaveBeenCalled();
  });
});
