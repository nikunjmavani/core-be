import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';

/**
 * Default TTL for a signed media read URL (avatar / organization logo). Short by
 * design — the URL is minted fresh on every read, so a leaked URL expires quickly.
 */
export const MEDIA_READ_URL_TTL_SECONDS = 3600;

/** True when `value` is an absolute http(s) URL rather than a bare object key. */
function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Resolves a stored media reference to a URL safe to return in an API response
 * (TEN-07 / USER-10: private bucket + signed-on-read).
 *
 * @remarks
 * - **Algorithm:** `null`/empty → `null`; an absolute http(s) value (an external
 *   OAuth-provider avatar, or a legacy row that stored a public URL before this
 *   change) is returned as-is; otherwise the value is treated as a private object
 *   key and a short-lived presigned GET URL is minted via
 *   {@link ObjectStoragePort.createPresignedDownloadUrl}.
 * - **Failure modes:** propagates storage presign errors to the caller.
 * - **Side effects:** none beyond the (network-free) presign signature.
 * - **Notes:** external/legacy absolute URLs are intentionally NOT re-signed so
 *   provider avatars keep working and legacy public logos remain readable until the
 *   asset is re-uploaded (which then stores a key).
 */
export async function resolveStoredMediaReadUrl(
  objectStorage: ObjectStoragePort,
  storedValue: string | null,
  options: { expiresInSeconds?: number } = {},
): Promise<string | null> {
  if (storedValue === null || storedValue.length === 0) {
    return null;
  }
  if (isAbsoluteHttpUrl(storedValue)) {
    return storedValue;
  }
  return objectStorage.createPresignedDownloadUrl({
    key: storedValue,
    expiresInSeconds: options.expiresInSeconds ?? MEDIA_READ_URL_TTL_SECONDS,
  });
}
