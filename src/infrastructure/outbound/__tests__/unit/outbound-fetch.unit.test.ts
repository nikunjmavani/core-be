import { describe, it, expect, vi } from 'vitest';
import { outboundFetch } from '@/infrastructure/outbound/outbound-fetch.js';
import { ExternalServiceError } from '@/infrastructure/outbound/outbound-error.js';

describe('outboundFetch', () => {
  it('forwards X-Request-Id when requestId is provided', async () => {
    const fetchImplementation = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Headers;
      expect(headers.get('X-Request-Id')).toBe('req-abc-123');
      return new Response('{}', { status: 200 });
    });

    await outboundFetch({
      name: 'oauth-github',
      url: 'https://example.com/token',
      requestId: 'req-abc-123',
      expectedStatus: 200,
      fetchImplementation,
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('throws ExternalServiceError for unexpected HTTP status', async () => {
    const fetchImplementation = vi.fn(async () => new Response('bad', { status: 502 }));

    const rejection = outboundFetch({
      name: 'oauth-google',
      url: 'https://example.com/token',
      expectedStatus: 200,
      fetchImplementation,
    });

    await expect(rejection).rejects.toMatchObject({
      integration: 'oauth-google',
      category: 'http_5xx',
      status: 502,
    });
    await expect(rejection).rejects.toBeInstanceOf(ExternalServiceError);
  });
});
