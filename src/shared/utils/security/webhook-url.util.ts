import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { ValidationError } from '@/shared/errors/index.js';

/** A single DNS-resolved IP for a webhook hostname; `family` is `4` (IPv4) or `6` (IPv6). */
export type WebhookResolvedAddress = { address: string; family: number };

/** Blocked hostnames (case-insensitive). */
const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', '0.0.0.0'];

const WEBHOOK_URL_NOT_ALLOWED_KEY = 'errors:webhookUrlNotAllowed';

/** IP ranges that must not be targeted by outbound webhooks (SSRF protection). */
const BLOCKED_IP_RANGES = new Set<string>([
  'loopback',
  'private',
  'linkLocal',
  'uniqueLocal',
  'unspecified',
  'multicast',
  'reserved',
  'broadcast',
  'carrierGradeNat',
]);

/**
 * Strips IPv6 bracket notation from URL hostnames (e.g. `[::1]` → `::1`).
 */
function unbracketIpv6Hostname(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Normalizes IPv4-mapped and IPv4-compatible IPv6 addresses to IPv4 so private-range
 * checks cannot be bypassed via forms like `::ffff:127.0.0.1` or `::ffff:7f00:1`.
 */
function normalizeParsedAddress(address: ipaddr.IPv4 | ipaddr.IPv6): ipaddr.IPv4 | ipaddr.IPv6 {
  if (address.kind() === 'ipv6') {
    const ipv6Address = address as ipaddr.IPv6;
    if (ipv6Address.isIPv4MappedAddress()) {
      return ipv6Address.toIPv4Address();
    }
  }
  return address;
}

/**
 * Returns true when `address` resolves to a loopback, private, link-local, or other
 * non-internet-routable range. Unparseable literals are treated as unsafe.
 */
function isUnsafeIpLiteral(address: string): boolean {
  try {
    const parsed = normalizeParsedAddress(ipaddr.parse(address));
    return BLOCKED_IP_RANGES.has(parsed.range());
  } catch {
    return true;
  }
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
    if (isUnsafeIpLiteral(entry.address)) {
      throw new ValidationError(WEBHOOK_URL_NOT_ALLOWED_KEY, undefined, undefined, [
        { field: 'url', messageKey: WEBHOOK_URL_NOT_ALLOWED_KEY },
      ]);
    }
  }
}

function resolveLiteralHostname(hostname: string): WebhookResolvedAddress[] {
  const literalHost = unbracketIpv6Hostname(hostname);
  const family = isIP(literalHost);
  if (family === 0) {
    return [];
  }
  if (isUnsafeIpLiteral(literalHost)) {
    throw new ValidationError(WEBHOOK_URL_NOT_ALLOWED_KEY, undefined, undefined, [
      { field: 'url', messageKey: WEBHOOK_URL_NOT_ALLOWED_KEY },
    ]);
  }
  return [{ address: literalHost, family }];
}

/**
 * Resolves a webhook hostname once and validates addresses are not private/link-local.
 */
export async function resolveWebhookUrlAddresses(
  hostname: string,
): Promise<WebhookResolvedAddress[]> {
  const literalAddresses = resolveLiteralHostname(hostname);
  if (literalAddresses.length > 0) {
    return literalAddresses;
  }

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
 * - IPv4-mapped IPv6 literals (e.g. `[::ffff:127.0.0.1]`)
 *
 * @throws ValidationError if the URL is unsafe
 */
export async function validateWebhookUrl(urlString: string): Promise<void> {
  await assertWebhookUrlSafe(urlString);
}
