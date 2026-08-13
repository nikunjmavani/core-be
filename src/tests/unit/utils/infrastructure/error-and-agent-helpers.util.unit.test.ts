import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gzipBufferAsync } from '@/shared/utils/infrastructure/gzip.util.js';
import { getPostgresConstraintName } from '@/shared/utils/infrastructure/postgres-error.util.js';
import { parseUserAgent } from '@/shared/utils/http/user-agent.util.js';
import { isMagicByteVerifiable } from '@/shared/utils/validation/file-magic.util.js';

/**
 * Infrastructure helpers with no test naming them: constraint extraction, gzip, user-agent
 * parsing, and the magic-byte capability check.
 */

describe('getPostgresConstraintName', () => {
  // Repositories map a unique-violation to a 409 by reading the constraint name. Drivers and
  // wrappers nest the original error to varying depths, so a lookup that only checks the top
  // level silently degrades every conflict into a 500.

  it('reads the constraint from a top-level error', () => {
    expect(getPostgresConstraintName({ constraint_name: 'users_email_key' })).toBe(
      'users_email_key',
    );
  });

  it('reads the constraint through a nested cause', () => {
    const wrapped = { cause: { cause: { constraint_name: 'organizations_slug_key' } } };

    expect(getPostgresConstraintName(wrapped)).toBe('organizations_slug_key');
  });

  it('reads the constraint from a real Error carrying a cause chain', () => {
    const driverError = Object.assign(new Error('duplicate key'), {
      constraint_name: 'memberships_pkey',
    });
    const wrapped = new Error('insert failed', { cause: driverError });

    expect(getPostgresConstraintName(wrapped)).toBe('memberships_pkey');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a number', 42],
    ['an empty object', {}],
    ['an error with no constraint', new Error('nope')],
  ])('returns undefined for %s', (_label, error) => {
    expect(getPostgresConstraintName(error)).toBeUndefined();
  });

  it('ignores a non-string constraint_name', () => {
    // A driver returning a symbol or number here must not be handed on as if it were a name.
    expect(getPostgresConstraintName({ constraint_name: 123 })).toBeUndefined();
  });

  it('terminates on a self-referencing cause chain', () => {
    // A cycle would hang the error handler — the depth cap is what prevents that.
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;

    expect(() => getPostgresConstraintName(cyclic)).not.toThrow();
    expect(getPostgresConstraintName(cyclic)).toBeUndefined();
  });

  it('stops searching past the depth cap', () => {
    // Deliberately documents that the search is bounded: a constraint buried deeper than the cap
    // is not found, which is the intended trade against unbounded traversal.
    let deep: Record<string, unknown> = { constraint_name: 'buried_key' };
    for (let index = 0; index < 20; index += 1) deep = { cause: deep };

    expect(getPostgresConstraintName(deep)).toBeUndefined();
  });
});

describe('gzipBufferAsync', () => {
  it('produces output that gunzips back to the input', async () => {
    const input = Buffer.from('audit export payload — ünïcödé included', 'utf8');

    const compressed = await gzipBufferAsync(input);

    expect(Buffer.compare(gunzipSync(compressed), input)).toBe(0);
  });

  it('emits the gzip magic bytes so consumers can sniff the format', async () => {
    const compressed = await gzipBufferAsync(Buffer.from('x'));

    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
  });

  it('handles an empty buffer', async () => {
    const compressed = await gzipBufferAsync(Buffer.alloc(0));

    expect(gunzipSync(compressed).byteLength).toBe(0);
  });

  it('actually compresses repetitive data', async () => {
    // The reason the export path gzips at all; a passthrough implementation would still round-trip.
    const repetitive = Buffer.from('a'.repeat(10_000));

    const compressed = await gzipBufferAsync(repetitive);

    expect(compressed.byteLength).toBeLessThan(repetitive.byteLength / 10);
  });

  it('round-trips binary content unchanged', async () => {
    const binary = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x01, 0x00]);

    expect(Buffer.compare(gunzipSync(await gzipBufferAsync(binary)), binary)).toBe(0);
  });
});

describe('parseUserAgent', () => {
  // Feeds the device/browser labels shown in the session list. A user identifies a rogue session
  // by these strings, so a wrong label is a security-relevant bug, not cosmetics.

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('returns nulls for %s', (_label, agent) => {
    expect(parseUserAgent(agent)).toEqual({ device: null, browser: null });
  });

  it('identifies an iPhone running Safari', () => {
    const parsed = parseUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    );

    expect(parsed.device).toBe('iPhone');
    expect(parsed.browser).toBe('Safari');
  });

  it('identifies Windows running Chrome', () => {
    const parsed = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    expect(parsed.device).toBe('Windows');
    expect(parsed.browser).toBe('Chrome');
  });

  it('prefers Edge over Chrome, whose token Edge also carries', () => {
    // Every Chromium browser claims "Chrome"; matcher order is the whole contract here, and
    // getting it wrong labels every Edge session as Chrome.
    const parsed = parseUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    );

    expect(parsed.browser).toBe('Edge');
  });

  it('prefers Firefox over the Safari-family tokens', () => {
    const parsed = parseUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
    );

    expect(parsed.browser).toBe('Firefox');
    expect(parsed.device).toBe('Mac');
  });

  it('does not report Chrome for a plain Safari agent', () => {
    const parsed = parseUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    );

    expect(parsed.browser).toBe('Safari');
  });

  it('identifies Android and iPad devices', () => {
    expect(parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0.0.0').device).toBe(
      'Android',
    );
    expect(
      parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1').device,
    ).toBe('iPad');
  });

  it('returns nulls rather than guessing for an unrecognised agent', () => {
    // A bot or a curl request must not be mislabelled as a real device in the session list.
    expect(parseUserAgent('curl/8.4.0')).toEqual({ device: null, browser: null });
  });

  it('does not throw on a hostile user-agent string', () => {
    for (const agent of ['x'.repeat(5000), '%%%%', '\n\r\t', '../../etc/passwd']) {
      expect(() => parseUserAgent(agent)).not.toThrow();
    }
  });
});

describe('isMagicByteVerifiable', () => {
  // The upload confirm path only sniffs magic bytes for content types it has a signature for.
  // This predicate is what decides; a type wrongly reported as verifiable would be waved through
  // unverified.

  it('reports true for image types with known signatures', () => {
    expect(isMagicByteVerifiable('image/png')).toBe(true);
    expect(isMagicByteVerifiable('image/jpeg')).toBe(true);
  });

  it('reports false for a type with no signature', () => {
    expect(isMagicByteVerifiable('application/octet-stream')).toBe(false);
    expect(isMagicByteVerifiable('text/plain')).toBe(false);
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['uppercase', 'IMAGE/PNG'],
    ['with parameters', 'image/png; charset=binary'],
    ['a partial type', 'image/'],
  ])('reports false for %s', (_label, contentType) => {
    // Matching is exact; anything else must fall through to "cannot verify" rather than being
    // treated as a verified type.
    expect(isMagicByteVerifiable(contentType)).toBe(false);
  });
});
