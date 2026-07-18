import { env } from '@/shared/config/env.config.js';

/**
 * Shared configuration common to every `S3Client` in the codebase — region, retry budget, optional
 * static credentials, and an optional S3-compatible endpoint override.
 *
 * @remarks
 * - **Algorithm:** reads `S3_REGION` / `S3_MAX_ATTEMPTS` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`;
 *   when `S3_ENDPOINT` is set (MinIO / Cloudflare R2 / LocalStack / local dev) it adds `endpoint` +
 *   `forcePathStyle` (`S3_FORCE_PATH_STYLE`), so both API calls **and** presigned URLs target the
 *   custom endpoint. Unset → the AWS SDK targets the standard AWS S3 endpoint for the region.
 * - **Failure modes:** none — pure config assembly (missing credentials fall back to the SDK's
 *   default provider chain, e.g. an instance role in production).
 * - **Side effects:** none.
 * - **Notes:** callers spread the result and append call-site extras (e.g. the adapter's per-attempt
 *   `requestHandler` timeouts), so this stays the single place the endpoint/credentials logic lives.
 *   The return type is inferred (not annotated `S3ClientConfig`) so this file needs no S3 SDK import;
 *   the two S3Client call sites type-check the config against the SDK.
 */
export function buildSharedS3ClientConfig() {
  return {
    region: env.S3_REGION ?? 'us-east-1',
    maxAttempts: env.S3_MAX_ATTEMPTS,
    ...(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
    ...(env.S3_ENDPOINT
      ? { endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE }
      : {}),
  };
}
