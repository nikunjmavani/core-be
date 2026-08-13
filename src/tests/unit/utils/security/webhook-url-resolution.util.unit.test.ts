import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock('node:dns/promises', () => ({
  lookup: lookupMock,
  default: { lookup: lookupMock },
}));

import { resolveWebhookUrlAddresses } from '@/shared/utils/security/webhook-url.util.js';
import { ValidationError } from '@/shared/errors/index.js';

/**
 * Webhook hostname resolution — the step that turns a customer-supplied host into the addresses
 * the SSRF guard then judges.
 *
 * @remarks
 * `webhook-url.util.unit.test.ts` and `webhook-ssrf.security.test.ts` already cover the guard's
 * verdicts. What neither reaches is this resolver's own two responsibilities:
 *
 * 1. An IP **literal** never goes to DNS at all. It is judged directly, which is what stops
 *    `http://127.0.0.1/` or a bracketed IPv6 loopback from being resolved and waved through.
 * 2. A DNS failure becomes a `ValidationError` (a 4xx the customer can act on: "your host does
 *    not resolve"), not an unhandled driver error that would surface as a 500 and page someone.
 *
 * DNS is mocked so the suite is deterministic and makes no network calls.
 */
describe('resolveWebhookUrlAddresses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a public hostname through DNS and maps the entries', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);

    const addresses = await resolveWebhookUrlAddresses('example.com');

    expect(addresses).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    expect(lookupMock).toHaveBeenCalledWith('example.com', { all: true });
  });

  it('requests every address, not just the first', async () => {
    // `all: true` is the whole defence against a host that resolves to one public and one private
    // address; taking only the first would let the private one through.
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await resolveWebhookUrlAddresses('example.com');

    expect(lookupMock).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }));
  });

  it('judges an IPv4 literal without consulting DNS', async () => {
    const addresses = await resolveWebhookUrlAddresses('93.184.216.34');

    expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
    // The important half: a literal must never be handed to the resolver, where a rebinding
    // resolver could answer with something else.
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('judges an IPv6 literal without consulting DNS', async () => {
    const addresses = await resolveWebhookUrlAddresses('2606:2800:220:1::1');

    expect(addresses).toEqual([{ address: '2606:2800:220:1::1', family: 6 }]);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('unwraps a bracketed IPv6 literal', async () => {
    // URLs carry IPv6 hosts in brackets; failing to unwrap would make `isIP` return 0 and send
    // the bracketed string to DNS instead of judging it as a literal.
    const addresses = await resolveWebhookUrlAddresses('[2606:2800:220:1::1]');

    expect(addresses).toEqual([{ address: '2606:2800:220:1::1', family: 6 }]);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each([
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv4 all-zeros', '0.0.0.0'],
    ['RFC1918 private', '10.0.0.1'],
    ['link-local metadata', '169.254.169.254'],
    ['IPv6 loopback', '::1'],
    ['bracketed IPv6 loopback', '[::1]'],
    ['IPv4-mapped IPv6 loopback', '::ffff:127.0.0.1'],
  ])('rejects the %s literal before any DNS lookup', async (_label, hostname) => {
    await expect(resolveWebhookUrlAddresses(hostname)).rejects.toBeInstanceOf(ValidationError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('converts a DNS failure into a ValidationError the customer can act on', async () => {
    // An unhandled ENOTFOUND would surface as a 500 and page someone, for what is really
    // "the URL you typed does not resolve".
    lookupMock.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), {
        code: 'ENOTFOUND',
      }),
    );

    const error = await resolveWebhookUrlAddresses('does-not-exist.invalid').catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).errors?.[0]?.field).toBe('url');
    expect((error as ValidationError).errors?.[0]?.messageKey).toBe('errors:webhookUrlDnsFailed');
  });

  it('preserves a ValidationError thrown from inside the lookup path', async () => {
    // The not-allowed verdict must not be relabelled as a DNS failure — the two mean different
    // things to the caller and carry different message keys.
    const notAllowed = new ValidationError('errors:webhookUrlNotAllowed', undefined, undefined, [
      { field: 'url', messageKey: 'errors:webhookUrlNotAllowed' },
    ]);
    lookupMock.mockRejectedValue(notAllowed);

    await expect(resolveWebhookUrlAddresses('example.com')).rejects.toBe(notAllowed);
  });

  it('returns an empty list when DNS resolves to nothing', async () => {
    // Not an error here; the caller's guard decides what an empty address set means.
    lookupMock.mockResolvedValue([]);

    expect(await resolveWebhookUrlAddresses('example.com')).toEqual([]);
  });

  it('passes through a mixed public/private answer for the guard to reject', async () => {
    // This resolver is not the guard. Its job is to surface every address; filtering happens
    // downstream, and silently dropping the private one here would hide the attack rather than
    // block it.
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);

    const addresses = await resolveWebhookUrlAddresses('rebind.example.com');

    expect(addresses).toHaveLength(2);
    expect(addresses.map((entry) => entry.address)).toContain('10.0.0.5');
  });
});
