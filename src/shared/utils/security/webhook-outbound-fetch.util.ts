import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ValidationError } from '@/shared/errors/index.js';
import { env } from '@/shared/config/env.config.js';
import {
  assertWebhookUrlSafe,
  type WebhookResolvedAddress,
} from '@/shared/utils/security/webhook-url.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';

/** A fetch-compatible function returned by {@link createPinnedWebhookFetch}. */
export type PinnedWebhookFetch = typeof globalThis.fetch;

/**
 * Hard ceiling on the response body a webhook target may return (64 KB). Enforced while
 * streaming so a hostile or buggy endpoint cannot exhaust worker memory; the connection is
 * destroyed and the fetch rejected the moment the limit is crossed.
 */
export const WEBHOOK_RESPONSE_BODY_MAX_BYTES = 64 * 1024;

/** The pinned target produced by {@link resolveAndPinWebhookUrl}: parsed URL, IP, and resolved port. */
export type PinnedWebhookResolution = {
  parsed: URL;
  pinnedAddress: string;
  port: number;
};

function parseWebhookAllowlist(): string[] {
  const raw = env.WEBHOOK_URL_ALLOWLIST;
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function assertWebhookHostAllowed(hostname: string): void {
  const allowlist = parseWebhookAllowlist();
  if (allowlist.length === 0) {
    if (env.NODE_ENV === 'production') {
      throw new ValidationError('errors:webhookUrlAllowlistRequired', undefined, undefined, [
        { field: 'url', messageKey: 'errors:webhookUrlAllowlistRequired' },
      ]);
    }
    return;
  }
  const normalizedHost = hostname.toLowerCase();
  const allowed = allowlist.some((entry) => {
    if (entry.startsWith('*.')) {
      // Explicit wildcard — *.example.com permits any subdomain but not the apex itself.
      const baseDomain = entry.slice(2);
      return normalizedHost.endsWith(`.${baseDomain}`);
    }
    return normalizedHost === entry;
  });
  if (!allowed) {
    throw new ValidationError('errors:webhookUrlNotAllowed', undefined, undefined, [
      { field: 'url', messageKey: 'errors:webhookUrlNotAllowed' },
    ]);
  }
}

function pickPinnedAddress(addresses: WebhookResolvedAddress[]): string {
  const first = addresses[0];
  if (!first) {
    throw new ValidationError('errors:webhookUrlDnsFailed', undefined, undefined, [
      { field: 'url', messageKey: 'errors:webhookUrlDnsFailed' },
    ]);
  }
  return first.address;
}

function resolveWebhookPort(parsed: URL): number {
  if (parsed.port !== '') {
    return Number.parseInt(parsed.port, 10);
  }
  return parsed.protocol === 'https:' ? 443 : 80;
}

async function pinnedNodeFetch(
  targetUrl: URL,
  pinnedAddress: string,
  port: number,
  init?: RequestInit,
): Promise<Response> {
  const isHttps = targetUrl.protocol === 'https:';
  const requestFunction = isHttps ? httpsRequest : httpRequest;
  const headerRecord: Record<string, string> = {};
  if (init?.headers) {
    const headers = new Headers(init.headers);
    headers.forEach((value, key) => {
      // eslint-disable-next-line security/detect-object-injection -- key from Headers iteration (server-controlled outbound request).
      headerRecord[key] = value;
    });
  }
  headerRecord.host = targetUrl.hostname;

  return new Promise((resolve, reject) => {
    const request = requestFunction(
      {
        host: pinnedAddress,
        port,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: init?.method ?? 'GET',
        headers: headerRecord,
        servername: isHttps ? targetUrl.hostname : undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        let exceededLimit = false;
        response.on('data', (chunk: Buffer) => {
          if (exceededLimit) return;
          receivedBytes += chunk.length;
          if (receivedBytes > WEBHOOK_RESPONSE_BODY_MAX_BYTES) {
            exceededLimit = true;
            request.destroy();
            reject(new Error('webhook.fetch.response_too_large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (exceededLimit) return;
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
          resolve(
            new Response(
              Buffer.concat(chunks),
              omitUndefined({
                status: response.statusCode ?? 500,
                statusText: response.statusMessage,
                headers: responseHeaders,
              }),
            ),
          );
        });
      },
    );

    request.on('error', reject);

    if (init?.signal) {
      init.signal.addEventListener('abort', () => {
        request.destroy();
        reject(new Error('webhook.fetch.aborted'));
      });
    }

    const body = init?.body;
    if (body === undefined || body === null) {
      request.end();
      return;
    }
    if (typeof body === 'string') {
      request.end(body);
      return;
    }
    if (body instanceof Uint8Array) {
      request.end(body);
      return;
    }
    reject(new Error('webhook.fetch.unsupported_body_type'));
  });
}

/**
 * Resolves webhook DNS once, validates SSRF rules + optional hostname allowlist, and returns a pinned target.
 * Outbound delivery must use this (or {@link createPinnedWebhookFetch}) so DNS rebinding cannot redirect fetches.
 */
export async function resolveAndPinWebhookUrl(
  webhookUrl: string,
): Promise<PinnedWebhookResolution> {
  const addresses = await assertWebhookUrlSafe(webhookUrl);
  const parsed = new URL(webhookUrl);
  assertWebhookHostAllowed(parsed.hostname);
  return {
    parsed,
    pinnedAddress: pickPinnedAddress(addresses),
    port: resolveWebhookPort(parsed),
  };
}

/**
 * Returns a fetch implementation that connects to the IP from a single pre-delivery DNS resolution
 * while preserving the original Host header and TLS SNI.
 */
export async function createPinnedWebhookFetch(webhookUrl: string): Promise<PinnedWebhookFetch> {
  const { pinnedAddress, port } = await resolveAndPinWebhookUrl(webhookUrl);

  return (input, init) => {
    let targetUrl: URL;
    if (typeof input === 'string') {
      targetUrl = new URL(input);
    } else if (input instanceof URL) {
      targetUrl = input;
    } else {
      targetUrl = new URL(input.url);
    }
    return pinnedNodeFetch(targetUrl, pinnedAddress, port, init);
  };
}
