import { getEnv } from '@/shared/config/env.config.js';

/**
 * Object-key prefixes whose objects are PUBLIC media — safe to expose via an unauthenticated URL
 * (audit-#13). Everything else (`user-files/`, `organization-files/`) is private and must only be
 * served through short-lived presigned download URLs, never {@link buildPublicMediaUrl}.
 */
export const PUBLIC_MEDIA_KEY_PREFIXES = ['avatars/', 'organization-logos/'] as const;

/** True when `key` is under a public-media prefix and may receive an unauthenticated URL. */
export function isPublicMediaKey(key: string): boolean {
  return PUBLIC_MEDIA_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Builds an unauthenticated URL for a PUBLIC-media object (audit-#13).
 *
 * @remarks
 * - **Algorithm:** when `PUBLIC_MEDIA_BASE_URL` is set (a CDN / CloudFront distribution scoped to
 *   the public prefixes) the URL is built from that base, so the S3 bucket can keep "Block all
 *   public access" enabled — the documented production posture — while public media stays
 *   reachable. When unset (local/dev) it falls back to the virtual-hosted S3 URL.
 * - **Failure modes:** throws when `key` is NOT under a public-media prefix, so a private object
 *   (`user-files/`, `organization-files/`) can never be accidentally handed out as a public link;
 *   throws when the bucket is required (S3 fallback) but unconfigured.
 * - **Side effects:** none (pure string building).
 */
export function buildPublicMediaUrl(
  key: string,
  options: { bucket: string | undefined; region: string },
): string {
  if (!isPublicMediaKey(key)) {
    throw new Error(`refusing to build a public media URL for non-public key: ${key}`);
  }
  const base = getEnv().PUBLIC_MEDIA_BASE_URL;
  if (base) {
    return new URL(encodeURI(key), base.endsWith('/') ? base : `${base}/`).toString();
  }
  if (!options.bucket) {
    throw new Error('S3_BUCKET is not configured');
  }
  return `https://${options.bucket}.s3.${options.region}.amazonaws.com/${encodeURI(key)}`;
}
