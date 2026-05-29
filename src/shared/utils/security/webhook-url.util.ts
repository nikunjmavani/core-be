import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { ValidationError } from '@/shared/errors/index.js';

/** A single DNS-resolved IP for a webhook hostname; `family` is `4` (IPv4) or `6` (IPv6). */
export type WebhookResolvedAddress = { address: string; family: number };

/** Private and link-local IP ranges that must not be targeted by webhooks (SSRF protection). */
const PRIVATE_IPV4_RANGES = [
  { start: 0x00000000, end: 0x00ffffff }, // 0.0.0.0/8 (current network / unspecified)
  { start: 0x7f000000, end: 0x7fffffff }, // 127.0.0.0/8
  { start: 0x0a000000, end: 0x0affffff }, // 10.0.0.0/8
  { start: 0x64400000, end: 0x647fffff }, // 100.64.0.0/10 (CGNAT, RFC 6598)
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
  // ::1 (loopback), :: (unspecified), fc00::/7 (unique local), fe80::/10 (link-local)
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

/**
 * Extracts the embedded IPv4 from an IPv4-mapped (`::ffff:1.2.3.4`) or IPv4-compatible
 * (`::1.2.3.4`) IPv6 literal, or `null` when the address carries no dotted-quad suffix.
 * Used to re-run the IPv4 private-range checks so a mapped form like
 * `::ffff:169.254.169.254` cannot smuggle a cloud-metadata address past the filter.
 */
function extractEmbeddedIpv4(normalizedIpv6: string): string | null {
  const lastColonIndex = normalizedIpv6.lastIndexOf(':');
  if (lastColonIndex === -1) return null;
  const suffix = normalizedIpv6.slice(lastColonIndex + 1);
  return isIPv4(suffix) ? suffix : null;
}

/**
 * Classifies a single resolved address as private/link-local/unsafe. Normalizes with
 * `node:net` so IPv4-mapped/compatible IPv6 forms are unwrapped to their IPv4 and re-checked,
 * and any unrecognized literal is rejected defensively.
 */
function isResolvedAddressPrivate(address: string): boolean {
  if (isIPv4(address)) {
    return isPrivateIpv4(address);
  }
  if (isIPv6(address)) {
    const normalized = address.toLowerCase();
    const embeddedIpv4 = extractEmbeddedIpv4(normalized);
    if (embeddedIpv4 !== null) {
      // Mapped/compatible IPv6 carrying an IPv4 — block when the embedded IPv4 is private.
      return isPrivateIpv4(embeddedIpv4);
    }
    return isPrivateIpv6(normalized);
  }
  // Not a recognizable IP literal — reject rather than risk an SSRF bypass.
  return true;
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
    if (isResolvedAddressPrivate(entry.address)) {
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
