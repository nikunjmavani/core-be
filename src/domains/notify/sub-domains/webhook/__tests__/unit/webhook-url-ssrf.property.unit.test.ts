import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { ValidationError } from '@/shared/errors/index.js';
import { validateWebhookUrl } from '@/shared/utils/security/webhook-url.util.js';
import { propertyAssertOptions } from '@/tests/helpers/fast-check-property.util.js';

const propertyOptions = propertyAssertOptions();

// IP-literal hostnames never reach DNS (resolveLiteralHostname short-circuits), but mock the
// resolver anyway so a generator bug producing a NAME can never make a live lookup from a test.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockRejectedValue(new Error('dns lookup must not run for IP literals')),
}));

/**
 * Layer 2 (property) for the SSRF guard the outbound webhook sender depends on. The example suite
 * (29 cases) pins the addresses its author thought of; these pin the RANGES — any address inside
 * a blocked block must refuse, any address in a known-public block must pass, and the
 * IPv4-mapped-IPv6 spelling of a blocked address must behave exactly like its IPv4 form (the
 * classic bypass: `[::ffff:10.0.0.1]`).
 */

/** Arbitrary host inside each blocked IPv4 range, generated across the whole block. */
const blockedIpv4 = fc.oneof(
  // 10.0.0.0/8
  fc
    .tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 254 }),
    )
    .map(([b, c, d]) => `10.${b}.${c}.${d}`),
  // 172.16.0.0/12
  fc
    .tuple(
      fc.integer({ min: 16, max: 31 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 254 }),
    )
    .map(([b, c, d]) => `172.${b}.${c}.${d}`),
  // 192.168.0.0/16
  fc
    .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 1, max: 254 }))
    .map(([c, d]) => `192.168.${c}.${d}`),
  // 127.0.0.0/8 loopback
  fc
    .tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 1, max: 254 }),
    )
    .map(([b, c, d]) => `127.${b}.${c}.${d}`),
  // 169.254.0.0/16 link-local — includes the cloud metadata endpoint
  fc
    .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 1, max: 254 }))
    .map(([c, d]) => `169.254.${c}.${d}`),
);

/** First octets that are unambiguously public unicast for any remaining octet pattern. */
const PUBLIC_FIRST_OCTETS = [23, 34, 45, 52, 63, 93, 104, 151, 155, 199, 203, 208, 212, 216];

const publicIpv4 = fc
  .tuple(
    fc.constantFrom(...PUBLIC_FIRST_OCTETS),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

describe('webhook SSRF guard over IP ranges (property)', () => {
  it('rejects EVERY address in the private, loopback, and link-local blocks', async () => {
    await fc.assert(
      fc.asyncProperty(blockedIpv4, async (address) => {
        // Any single accepted address in these blocks is a full SSRF: the delivery worker
        // would POST signed payloads into the internal network.
        await expect(validateWebhookUrl(`https://${address}/hook`)).rejects.toBeInstanceOf(
          ValidationError,
        );
      }),
      propertyOptions,
    );
  });

  it('accepts every unambiguously public unicast address — the guard is a range check, not a deny-all', async () => {
    await fc.assert(
      fc.asyncProperty(publicIpv4, async (address) => {
        // The non-vacuity half: a guard that refused everything would also pass the
        // rejection property above.
        await expect(validateWebhookUrl(`https://${address}/hook`)).resolves.toBeUndefined();
      }),
      propertyOptions,
    );
  });

  it('treats the IPv4-mapped IPv6 spelling of a blocked address exactly like its IPv4 form', async () => {
    await fc.assert(
      fc.asyncProperty(blockedIpv4, async (address) => {
        // `[::ffff:10.0.0.1]` is the canonical range-check bypass; normalization must make
        // the two spellings indistinguishable to the guard.
        await expect(validateWebhookUrl(`https://[::ffff:${address}]/hook`)).rejects.toBeInstanceOf(
          ValidationError,
        );
      }),
      propertyOptions,
    );
  });

  it('rejects any non-http(s) scheme and any URL carrying userinfo, whatever the host', async () => {
    const scheme = fc.constantFrom('ftp', 'file', 'gopher', 'ws', 'redis', 'ssh');
    const credentials = fc.stringMatching(/^[a-z0-9]{1,12}$/);
    await fc.assert(
      fc.asyncProperty(scheme, publicIpv4, credentials, async (badScheme, address, user) => {
        await expect(validateWebhookUrl(`${badScheme}://${address}/hook`)).rejects.toBeInstanceOf(
          ValidationError,
        );
        // Userinfo smuggling (`https://user@evil/…`) is refused even for a public host.
        await expect(validateWebhookUrl(`https://${user}@${address}/hook`)).rejects.toBeInstanceOf(
          ValidationError,
        );
      }),
      propertyOptions,
    );
  });

  it('rejects every explicit port except 443, for any public host', async () => {
    const nonHttpsPort = fc.integer({ min: 1, max: 65_535 }).filter((port) => port !== 443);
    await fc.assert(
      fc.asyncProperty(publicIpv4, nonHttpsPort, async (address, port) => {
        // Port pinning stops the sender being aimed at internal services that happen to be
        // exposed on a public IP's alternate ports.
        await expect(validateWebhookUrl(`https://${address}:${port}/hook`)).rejects.toBeInstanceOf(
          ValidationError,
        );
      }),
      propertyOptions,
    );
  });
});
