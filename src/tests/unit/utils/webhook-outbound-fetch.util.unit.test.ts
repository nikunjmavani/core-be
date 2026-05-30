import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

vi.mock('node:http', () => ({
  request: vi.fn(),
}));

const mockedLookup = vi.mocked(lookup);
const mockedHttpRequest = vi.mocked(httpRequest);

function mockDnsLookupAll(addresses: Array<{ address: string; family: 4 | 6 }>): void {
  mockedLookup.mockResolvedValue(addresses as unknown as Awaited<ReturnType<typeof lookup>>);
}

describe('webhook-outbound-fetch.util', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    mockedLookup.mockReset();
    mockedHttpRequest.mockReset();
  });

  it('resolveAndPinWebhookUrl returns pinned public IPv4 and port', async () => {
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);
    const { resolveAndPinWebhookUrl } = await import(
      '@/shared/utils/security/webhook-outbound-fetch.util.js'
    );
    const resolution = await resolveAndPinWebhookUrl('https://hooks.example.com/path');
    expect(resolution.pinnedAddress).toBe('93.184.216.34');
    expect(resolution.port).toBe(443);
    expect(resolution.parsed.hostname).toBe('hooks.example.com');
    expect(mockedLookup).toHaveBeenCalledOnce();
  });

  it('rejects hostname not on WEBHOOK_URL_ALLOWLIST when configured', async () => {
    vi.stubEnv('WEBHOOK_URL_ALLOWLIST', 'allowed.example.com');
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);
    const { resolveAndPinWebhookUrl } = await import(
      '@/shared/utils/security/webhook-outbound-fetch.util.js'
    );
    await expect(resolveAndPinWebhookUrl('https://evil.example/hook')).rejects.toMatchObject({
      messageKey: 'errors:webhookUrlNotAllowed',
    });
  });

  it('allows subdomains of WEBHOOK_URL_ALLOWLIST entries', async () => {
    vi.stubEnv('WEBHOOK_URL_ALLOWLIST', 'allowed.example.com');
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);
    const { resolveAndPinWebhookUrl } = await import(
      '@/shared/utils/security/webhook-outbound-fetch.util.js'
    );
    await expect(
      resolveAndPinWebhookUrl('https://hooks.allowed.example.com/path'),
    ).resolves.toMatchObject({ pinnedAddress: '93.184.216.34' });
  });

  it('createPinnedWebhookFetch connects to pinned IP (no second DNS lookup on fetch)', async () => {
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);

    let capturedHost: string | undefined;
    mockedHttpRequest.mockImplementation(((options, responseCallback) => {
      const requestOptions = options as RequestOptions;
      capturedHost = requestOptions.host ?? undefined;
      const response = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {},
        on: (event: string, handler: (chunk?: Buffer) => void) => {
          if (event === 'data') handler(Buffer.from(''));
          if (event === 'end') handler();
        },
      } as IncomingMessage;
      (responseCallback as (response: IncomingMessage) => void)(response);
      return { on: vi.fn(), end: vi.fn() } as unknown as ReturnType<typeof httpRequest>;
    }) as typeof httpRequest);

    const { createPinnedWebhookFetch } = await import(
      '@/shared/utils/security/webhook-outbound-fetch.util.js'
    );
    const pinnedFetch = await createPinnedWebhookFetch('http://hooks.example.com/deliver');
    await pinnedFetch('http://hooks.example.com/deliver', { method: 'POST', body: '{}' });

    expect(capturedHost).toBe('93.184.216.34');
    expect(mockedLookup).toHaveBeenCalledOnce();
  });

  it('aborts and rejects when the response body exceeds the 64 KB ceiling', async () => {
    mockDnsLookupAll([{ address: '93.184.216.34', family: 4 }]);

    const destroy = vi.fn();
    mockedHttpRequest.mockImplementation(((options, responseCallback) => {
      void (options as RequestOptions);
      const oversizedChunk = Buffer.alloc(65 * 1024, 0x61);
      // Defer like real Node so `const request = httpRequest(...)` is assigned before the
      // response callback (which references `request.destroy()`) runs.
      setImmediate(() => {
        const response = {
          statusCode: 200,
          statusMessage: 'OK',
          headers: {},
          on: (event: string, handler: (chunk?: Buffer) => void) => {
            if (event === 'data') handler(oversizedChunk);
            if (event === 'end') handler();
          },
        } as IncomingMessage;
        (responseCallback as (response: IncomingMessage) => void)(response);
      });
      return { on: vi.fn(), end: vi.fn(), destroy } as unknown as ReturnType<typeof httpRequest>;
    }) as typeof httpRequest);

    const { createPinnedWebhookFetch } = await import(
      '@/shared/utils/security/webhook-outbound-fetch.util.js'
    );
    const pinnedFetch = await createPinnedWebhookFetch('http://hooks.example.com/deliver');

    await expect(
      pinnedFetch('http://hooks.example.com/deliver', { method: 'POST', body: '{}' }),
    ).rejects.toThrow(/response_too_large/);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not re-resolve DNS when lookup would return private IP on a second query', async () => {
    let lookupCount = 0;
    mockedLookup.mockImplementation(async () => {
      lookupCount += 1;
      if (lookupCount === 1) {
        return [{ address: '93.184.216.34', family: 4 }] as unknown as Awaited<
          ReturnType<typeof lookup>
        >;
      }
      return [{ address: '10.0.0.1', family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>;
    });

    let capturedHost: string | undefined;
    mockedHttpRequest.mockImplementation(((options, responseCallback) => {
      const requestOptions = options as RequestOptions;
      capturedHost = requestOptions.host ?? undefined;
      const response = {
        statusCode: 200,
        statusMessage: 'OK',
        headers: {},
        on: (event: string, handler: (chunk?: Buffer) => void) => {
          if (event === 'data') handler(Buffer.from(''));
          if (event === 'end') handler();
        },
      } as IncomingMessage;
      (responseCallback as (response: IncomingMessage) => void)(response);
      return { on: vi.fn(), end: vi.fn() } as unknown as ReturnType<typeof httpRequest>;
    }) as typeof httpRequest);

    const { createPinnedWebhookFetch } = await import(
      '@/shared/utils/security/webhook-outbound-fetch.util.js'
    );
    const pinnedFetch = await createPinnedWebhookFetch('http://rebind.example/hook');
    await pinnedFetch('http://rebind.example/hook', { method: 'POST', body: '{}' });

    expect(capturedHost).toBe('93.184.216.34');
    expect(lookupCount).toBe(1);
  });
});
