import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/shared/config/env.config.js';
import { outboundCall } from '@/infrastructure/outbound/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const S3_BUCKET_NOT_CONFIGURED_MESSAGE = 'S3_BUCKET is not configured';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  s3Client = new S3Client({
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
  });

  return s3Client;
}

/**
 * Generate a presigned PUT URL for direct client uploads to S3.
 *
 * @remarks
 * - **Algorithm:** Builds a `PutObjectCommand` with the target key and content type, then
 *   calls `getSignedUrl` with the caller-supplied expiry.
 * - **Failure modes:** Throws when `S3_BUCKET` is unconfigured; AWS SDK errors propagate to
 *   the caller (not wrapped via {@link outboundCall}).
 * - **Side effects:** None — signing is local and does not contact S3.
 * - **Notes:** Unlike the presigned-POST flow in `S3ObjectStorageAdapter`, this PUT signature
 *   does not enforce `content-length-range`; callers should rely on the upload domain's
 *   own size cap and run `headObject` to verify on confirm.
 */
export async function createPresignedUploadUrl(options: {
  key: string;
  contentType: string;
  expiresInSeconds: number;
}): Promise<string> {
  const client = getS3Client();
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.key,
    ContentType: options.contentType,
  });

  return getSignedUrl(client, command, { expiresIn: options.expiresInSeconds });
}

/**
 * Build the public URL for an S3 object.
 *
 * @remarks
 * - **Algorithm:** Concatenates `https://<bucket>.s3.<region>.amazonaws.com/<key>`.
 * - **Failure modes:** Throws when `S3_BUCKET` is unconfigured.
 * - **Side effects:** None — pure string formatting.
 * - **Notes:** Returns the virtual-hosted-style URL only; not suitable for buckets that
 *   are not publicly readable or that live in a non-standard partition (e.g. AWS GovCloud).
 *   For private downloads use `createPresignedDownloadUrl` on the adapter instead.
 */
export function getObjectUrl(key: string): string {
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION ?? 'us-east-1';
  if (!bucket) throw new Error(S3_BUCKET_NOT_CONFIGURED_MESSAGE);
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * Verify an uploaded object exists and check its content type via HeadObject.
 *
 * @remarks
 * - **Algorithm:** Issues `HeadObjectCommand` via {@link outboundCall} so the call is
 *   bounded by the shared S3 timeout and circuit breaker; returns the surfaced
 *   `ContentType`/`ContentLength`.
 * - **Failure modes:** Throws when `S3_BUCKET` is unconfigured. Any thrown S3 error
 *   (including `NoSuchKey`/403) is logged and converted to `null` so callers can treat
 *   "not found" and "transient failure" the same way.
 * - **Side effects:** Single GET to S3 (HEAD request); no writes.
 * - **Notes:** Used by the upload confirm flow to validate that the presigned PUT/POST
 *   actually landed before flipping the row from PENDING to READY.
 */
export async function headObject(
  key: string,
): Promise<{ contentType: string | undefined; contentLength: number | undefined } | null> {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

  try {
    return await outboundCall({
      name: 's3',
      operation: async (signal) => {
        const client = getS3Client();
        const response = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
          { abortSignal: signal },
        );
        return {
          contentType: response.ContentType,
          contentLength: response.ContentLength,
        };
      },
    });
  } catch (error) {
    logger.error({ error, key, bucket }, 's3.headObject.failed');
    return null;
  }
}

/**
 * Upload a buffer to S3 (server-side writes, e.g. audit export).
 *
 * @remarks
 * - **Algorithm:** Wraps `PutObjectCommand` in {@link outboundCall} so the call is bound
 *   by the shared S3 timeout/circuit; user-defined `metadata` is forwarded only when set
 *   to avoid sending `Metadata: undefined`.
 * - **Failure modes:** Throws when `S3_BUCKET` is unconfigured; any wrapped error becomes
 *   an `ExternalServiceError` (503).
 * - **Side effects:** One PUT to S3. Overwrites whatever object exists at `key`.
 * - **Notes:** Intended for server-side writes such as the audit cold-export worker — for
 *   client-driven uploads, prefer the presigned PUT/POST flow instead.
 */
export async function putObjectBuffer(options: {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<void> {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

  await outboundCall({
    name: 's3',
    operation: async (signal) => {
      const client = getS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: options.key,
          Body: options.body,
          ContentType: options.contentType,
          ...(options.metadata ? { Metadata: options.metadata } : {}),
        }),
        { abortSignal: signal },
      );
    },
  });
}

/**
 * Delete an object from S3. Returns false when the delete fails (caller may still tombstone the row).
 *
 * @remarks
 * - **Algorithm:** `DeleteObjectCommand` via {@link outboundCall}; any error is caught,
 *   logged, and turned into `false` so retention/tombstone workers can keep their own
 *   queue ordering intact.
 * - **Failure modes:** Throws only when `S3_BUCKET` is unconfigured. Transient AWS errors,
 *   `AccessDenied`, and `NoSuchKey` all surface as `false`.
 * - **Side effects:** One DELETE to S3 (S3 deletes are eventually consistent — repeated
 *   `headObject` calls may still observe the object briefly).
 * - **Notes:** Callers that need stricter accounting (e.g. legal hold) should re-check via
 *   {@link headObject} before tombstoning the source row.
 */
export async function deleteObject(key: string): Promise<boolean> {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

  try {
    await outboundCall({
      name: 's3',
      operation: async (signal) => {
        const client = getS3Client();
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
          { abortSignal: signal },
        );
      },
    });
    return true;
  } catch (error) {
    logger.error({ error, key, bucket }, 's3.deleteObject.failed');
    return false;
  }
}
