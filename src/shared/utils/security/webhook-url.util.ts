import { lookup } from 'node:dns/promises';
import { ValidationError } from '@/shared/errors/index.js';

export type WebhookResolvedAddress = { address: string; family: number };

/** Private and link-local IP ranges that must not be targeted by webhooks (SSRF protection). */
const PRIVATE_IPV4_RANGES = [
  { start: 0x7f000000, end: 0x7fffffff }, // 127.0.0.0/8
  { start: 0x0a000000, end: 0x0affffff }, // 10.0.0.0/8
  { start: 0xac100000, end: 0xac1fffff }, // 172.16.0.0/12
  { start: 0xc0a80000, end: 0xc0a8ffff }, // 192.168.0.0/16
  { start: 0xa9fe0000, end: 0xa9feffff }, // 169.254.0.0/16 (link-local, includes cloud metadata)
] as const;

/** Blocked hostnames (case-insensitive). */
const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0'];

const WEBHOOK_URL_NOT_ALLOWED_KEY = 'errors:webhookUrlNotAllowed';

function ipv4ToNumber(parts: [string, string, string, string]): number {
  return (
    ((parseInt(parts[0], 10) << 24) |
      (parseInt(parts[1], 10) << 16) |
      (parseInt(parts[2], 10) << 8) |
      parseInt(parts[3], 10)) >>>
    0
  );
}

function splitIpv4Address(address: string): [string, string, string, string] | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }
  return parts as [string, string, string, string];
}

function isPrivateIpv4(address: string): boolean {
  const parts = splitIpv4Address(address);
  if (parts === null) return false;
  const num = ipv4ToNumber(parts);
  return PRIVATE_IPV4_RANGES.some((range) => num >= range.start && num <= range.end);
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  // ::1 (loopback), fc00::/7 (unique local), fe80::/10 (link-local)
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function assertWebhookScheme(parsed: URL): void {
  const scheme = parsed.protocol.slice(0, -1);
  if (scheme !== 'http' && scheme !== 'https') {
    throw new ValidationError('errors:webhookUrlInvalidScheme', { scheme }, undefined, [
      { field: 'url', messageKey: 'errors:webhookUrlInvalidScheme' },
    ]);
  }
}

function assertWebhookHostnameNotBlocked(hostname: string): void {
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    throw new ValidationError(WEBHOOK_URL_NOT_ALLOWED_KEY, undefined, undefined, [
      { field: 'url', messageKey: WEBHOOK_URL_NOT_ALLOWED_KEY },
    ]);
  }
}

function assertResolvedAddressesNotPrivate(addresses: WebhookResolvedAddress[]): void {
  for (const entry of addresses) {
    const address = entry.address;
    if (address.includes('.')) {
      if (isPrivateIpv4(address)) {
        throw new ValidationError(WEBHOOK_URL_NOT_ALLOWED_KEY, undefined, undefined, [
          { field: 'url', messageKey: WEBHOOK_URL_NOT_ALLOWED_KEY },
        ]);
      }
    } else if (isPrivateIpv6(address)) {
      throw new ValidationError(WEBHOOK_URL_NOT_ALLOWED_KEY, undefined, undefined, [
        { field: 'url', messageKey: WEBHOOK_URL_NOT_ALLOWED_KEY },
      ]);
    }
  }
}

/**
 * Resolves a webhook hostname once and validates addresses are not private/link-local.
 */
export async function resolveWebhookUrlAddresses(
  hostname: string,
): Promise<WebhookResolvedAddress[]> {
  try {
    const addresses = await lookup(hostname, { all: true });
    return addresses.map((entry) => ({ address: entry.address, family: entry.family }));
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('errors:webhookUrlDnsFailed', undefined, undefined, [
      { field: 'url', messageKey: 'errors:webhookUrlDnsFailed' },
    ]);
  }
}

/**
 * Validates a webhook URL for SSRF safety and returns resolved addresses (single DNS lookup).
 * Rejects non-HTTP(S) schemes, blocked hostnames, and private/link-local resolved IPs.
 *
 * @throws ValidationError if the URL is unsafe
 */
export async function assertWebhookUrlSafe(urlString: string): Promise<WebhookResolvedAddress[]> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new ValidationError('errors:webhookUrlInvalid', undefined, undefined, [
      { field: 'url', messageKey: 'errors:webhookUrlInvalid' },
    ]);
  }

  assertWebhookScheme(parsed);
  assertWebhookHostnameNotBlocked(parsed.hostname);
  const addresses = await resolveWebhookUrlAddresses(parsed.hostname);
  assertResolvedAddressesNotPrivate(addresses);
  return addresses;
}

/**
 * Validates a webhook URL for SSRF safety. Rejects:
 * - Non-HTTP(S) schemes
 * - Blocked hostnames (localhost, 127.0.0.1, 0.0.0.0)
 * - Hostnames resolving to private/link-local IPs
 * - Cloud metadata endpoints (169.254.169.254)
 *
 * @throws ValidationError if the URL is unsafe
 */
export async function validateWebhookUrl(urlString: string): Promise<void> {
  await assertWebhookUrlSafe(urlString);
}
