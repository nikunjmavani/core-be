import { describe, expect, it, vi } from 'vitest';
import { buildIdempotencyActorRateKey } from '@/shared/utils/idempotency/idempotency-key.util.js';
import {
  MEDIA_READ_URL_TTL_SECONDS,
  resolveStoredMediaReadUrl,
} from '@/shared/utils/infrastructure/media-url.util.js';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';

/**
 * Idempotency actor keying and stored-media URL resolution.
 */

describe('buildIdempotencyActorRateKey', () => {
  // This key is the bucket an idempotency rate limit counts into. Two properties matter: two
  // different actors must never share a bucket (one caller could exhaust another's allowance),
  // and one actor must always land in the same bucket (or the limit does not bind at all).

  it('prefers the API key when both an API key and a user are present', () => {
    // A machine caller acting on behalf of a user is still the machine for rate-limit purposes;
    // keying on the user would let one API key spread its load across every user it can act for.
    const key = buildIdempotencyActorRateKey({
      apiKeyPublicId: 'key_abcdefghijklmnopqrstu',
      userId: 'usr_abcdefghijklmnopqrstu',
    });

    expect(key).toBe('idempotency:actor-rate:api-key:key_abcdefghijklmnopqrstu');
  });

  it('falls back to the user when no API key is present', () => {
    expect(buildIdempotencyActorRateKey({ userId: 'usr_abcdefghijklmnopqrstu' })).toBe(
      'idempotency:actor-rate:user:usr_abcdefghijklmnopqrstu',
    );
  });

  it('returns null for an anonymous scope', () => {
    // Null means "no actor bucket" — the caller decides what to do, rather than everyone
    // anonymous sharing one key and rate-limiting each other.
    expect(buildIdempotencyActorRateKey({})).toBeNull();
  });

  it.each([
    ['empty strings', { apiKeyPublicId: '', userId: '' }],
    ['empty api key with no user', { apiKeyPublicId: '' }],
    ['empty user with no api key', { userId: '' }],
  ])('returns null for %s rather than an empty-suffix key', (_label, scope) => {
    // `idempotency:actor-rate:user:` with nothing after it would be a shared bucket for every
    // caller whose id failed to resolve — the worst possible collision.
    expect(buildIdempotencyActorRateKey(scope)).toBeNull();
  });

  it('falls through to the user when the API key is an empty string', () => {
    expect(
      buildIdempotencyActorRateKey({ apiKeyPublicId: '', userId: 'usr_abcdefghijklmnopqrstu' }),
    ).toBe('idempotency:actor-rate:user:usr_abcdefghijklmnopqrstu');
  });

  it('namespaces api-key and user buckets apart', () => {
    // Same raw id in both roles must not collide, which is what the `api-key:` / `user:` segment
    // is for.
    const sameId = 'abcdefghijklmnopqrstu';

    expect(buildIdempotencyActorRateKey({ apiKeyPublicId: sameId })).not.toBe(
      buildIdempotencyActorRateKey({ userId: sameId }),
    );
  });

  it('is stable for the same actor across calls', () => {
    const scope = { userId: 'usr_abcdefghijklmnopqrstu' };

    expect(buildIdempotencyActorRateKey(scope)).toBe(buildIdempotencyActorRateKey(scope));
  });

  it('distinguishes two different actors of the same kind', () => {
    expect(buildIdempotencyActorRateKey({ userId: 'usr_aaa' })).not.toBe(
      buildIdempotencyActorRateKey({ userId: 'usr_bbb' }),
    );
  });
});

describe('resolveStoredMediaReadUrl', () => {
  // Avatar and media columns hold either an S3 key (needs presigning) or an absolute URL from an
  // OAuth provider (must be passed through). Presigning an absolute URL would produce a broken
  // link; returning a raw key would leak the bucket layout and 404 for the client.

  function storage(overrides: Partial<ObjectStoragePort> = {}): ObjectStoragePort {
    return {
      createPresignedDownloadUrl: vi.fn(async () => 'https://signed.example.com/object?sig=abc'),
      ...overrides,
    } as unknown as ObjectStoragePort;
  }

  it.each([
    ['null', null],
    ['an empty string', ''],
  ])('returns null for %s without touching storage', async (_label, stored) => {
    const objectStorage = storage();

    expect(await resolveStoredMediaReadUrl(objectStorage, stored)).toBeNull();
    expect(objectStorage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('passes an absolute https URL through unchanged', async () => {
    // Provider avatars (Google, GitHub) are stored as absolute URLs.
    const objectStorage = storage();
    const providerUrl = 'https://lh3.googleusercontent.com/a/default-user=s96-c';

    expect(await resolveStoredMediaReadUrl(objectStorage, providerUrl)).toBe(providerUrl);
    expect(objectStorage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('passes an absolute http URL through unchanged', async () => {
    const objectStorage = storage();

    expect(await resolveStoredMediaReadUrl(objectStorage, 'http://example.com/a.png')).toBe(
      'http://example.com/a.png',
    );
  });

  it('presigns a stored object key', async () => {
    const objectStorage = storage();

    const url = await resolveStoredMediaReadUrl(objectStorage, 'avatars/usr_abc/profile.png');

    expect(url).toBe('https://signed.example.com/object?sig=abc');
    expect(objectStorage.createPresignedDownloadUrl).toHaveBeenCalledWith({
      key: 'avatars/usr_abc/profile.png',
      expiresInSeconds: MEDIA_READ_URL_TTL_SECONDS,
    });
  });

  it('honours an explicit TTL override', async () => {
    const objectStorage = storage();

    await resolveStoredMediaReadUrl(objectStorage, 'avatars/usr_abc/profile.png', {
      expiresInSeconds: 60,
    });

    expect(objectStorage.createPresignedDownloadUrl).toHaveBeenCalledWith({
      key: 'avatars/usr_abc/profile.png',
      expiresInSeconds: 60,
    });
  });

  it('treats a key that merely mentions http as a key, not a URL', async () => {
    // The check is for an absolute URL, not a substring; `http` appearing inside a filename must
    // not skip presigning and hand the client a raw bucket path.
    const objectStorage = storage();

    await resolveStoredMediaReadUrl(objectStorage, 'avatars/usr_abc/https-logo.png');

    expect(objectStorage.createPresignedDownloadUrl).toHaveBeenCalled();
  });

  it('presigns a key beginning with a slash rather than treating it as absolute', async () => {
    const objectStorage = storage();

    await resolveStoredMediaReadUrl(objectStorage, '/avatars/usr_abc/profile.png');

    expect(objectStorage.createPresignedDownloadUrl).toHaveBeenCalled();
  });

  it('does not swallow a storage failure', async () => {
    // A serializer that silently returned null here would render a missing avatar as "no avatar",
    // hiding an S3 outage behind a plausible-looking response.
    const objectStorage = storage({
      createPresignedDownloadUrl: vi.fn(async () => {
        throw new Error('S3 unavailable');
      }),
    });

    await expect(resolveStoredMediaReadUrl(objectStorage, 'avatars/a.png')).rejects.toThrow(
      'S3 unavailable',
    );
  });
});
