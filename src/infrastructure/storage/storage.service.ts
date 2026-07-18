import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/shared/config/env.config.js';
import { outboundCall } from '@/infrastructure/outbound/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { type S3HeadResult, isS3NotFoundError } from '@/infrastructure/storage/s3-error.util.js';
import { buildPublicMediaUrl } from '@/infrastructure/storage/public-media-url.util.js';
import { buildSharedS3ClientConfig } from '@/infrastructure/storage/s3-client-config.util.js';
import { ConfigurationError } from '@/shared/errors/index.js';

const S3_BUCKET_NOT_CONFIGURED_MESSAGE = 'S3_BUCKET is not configured';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3Client) return s3Client;

  s3Client = new S3Client(buildSharedS3ClientConfig());

  return s3Client;
}

/**
 * Generate a presigned PUT URL for direct client uploads to S3.
 *
 * @remarks
 * - **Algorithm:** Builds a `PutObjectCommand` with the target key and content type. When
 *   `maxContentLength` is supplied it is set as the command `ContentLength` and `content-length`
 *   is forced into the SigV4 signed headers, so S3 rejects a body whose length differs.
 *   `getSignedUrl` then signs with the caller-supplied expiry.
 * - **Failure modes:** Throws when `S3_BUCKET` is unconfigured; AWS SDK errors propagate to
 *   the caller (not wrapped via {@link outboundCall}).
 * - **Side effects:** None — signing is local and does not contact S3.
 * - **Notes:** A presigned PUT can only bind a single exact `Content-Length`, not a min/max
 *   range; for an enforced range (and the recommended production path) use the presigned POST
 *   flow in `S3ObjectStorageAdapter` (`UPLOAD_USE_PRESIGNED_POST=true`). When no
 *   `maxContentLength` is given the URL carries no size constraint, so callers must enforce
 *   their own cap and `headObject`-verify on confirm. The live upload domain uses the
 *   `S3ObjectStorageAdapter` PUT/POST flow, not this function.
 */
export async function createPresignedUploadUrl(options: {
  key: string;
  contentType: string;
  expiresInSeconds: number;
  maxContentLength?: number;
}): Promise<string> {
  const client = getS3Client();
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new ConfigurationError(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.key,
    ContentType: options.contentType,
    ...(options.maxContentLength !== undefined ? { ContentLength: options.maxContentLength } : {}),
  });

  return getSignedUrl(client, command, {
    expiresIn: options.expiresInSeconds,
    ...(options.maxContentLength !== undefined
      ? { signableHeaders: new Set(['content-length', 'content-type', 'host']) }
      : {}),
  });
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
  // audit-#13: only PUBLIC-media keys may receive an unauthenticated URL, and prefer the
  // PUBLIC_MEDIA_BASE_URL distribution so the bucket can keep Block-Public-Access enabled.
  return buildPublicMediaUrl(key, {
    bucket: env.S3_BUCKET,
    region: env.S3_REGION ?? 'us-east-1',
  });
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
  if (!bucket) throw new ConfigurationError(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

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
 * Discriminated `HeadObject` (audit-#5) used by destructive callers (the pending-upload sweep)
 * so a transient outage is never mistaken for an absent object.
 *
 * @remarks
 * - **Algorithm:** issues `HeadObjectCommand` via {@link outboundCall}; maps an explicit
 *   `NoSuchKey`/404 to `not_found` and every other failure (timeout, throttle, circuit-open,
 *   IAM denial, 5xx) to `transient_error` with the original cause.
 * - **Failure modes:** never returns a `found` result for a failed call; throws only when
 *   `S3_BUCKET` is unconfigured.
 * - **Side effects:** single S3 HEAD; no writes.
 */
export async function headObjectResult(
  key: string,
): Promise<S3HeadResult<{ contentType: string | undefined; contentLength: number | undefined }>> {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new ConfigurationError(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

  try {
    const metadata = await outboundCall({
      name: 's3',
      operation: async (signal) => {
        const response = await getS3Client().send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
          { abortSignal: signal },
        );
        return {
          contentType: response.ContentType,
          contentLength: response.ContentLength,
        };
      },
    });
    return { kind: 'found', metadata };
  } catch (error) {
    if (isS3NotFoundError(error)) {
      return { kind: 'not_found' };
    }
    logger.error({ error, key, bucket }, 's3.headObject.transient');
    return { kind: 'transient_error', cause: error };
  }
}

/** Default byte window for magic-byte verification of uploaded objects (512 B). */
const GET_OBJECT_MAGIC_BYTE_PREFIX_LENGTH = 512;

/**
 * Fetches the leading bytes of an S3 object for content verification (magic bytes).
 * Uses a ranged GET so large uploads are not fully buffered in the worker.
 *
 * @remarks
 * - **Algorithm:** `GetObjectCommand` with `Range: bytes=0-(maxBytes-1)` via {@link outboundCall}.
 * - **Failure modes:** returns `null` on S3 errors (logged); throws when `S3_BUCKET` is unset.
 * - **Side effects:** single ranged GET to S3.
 * - **Notes:** default window is 512 B — sufficient for {@link verifyFileMagicBytes}.
 */
export async function getObjectLeadingBytes(
  key: string,
  maxBytes: number = GET_OBJECT_MAGIC_BYTE_PREFIX_LENGTH,
): Promise<{ body: Buffer; contentType: string | undefined } | null> {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new ConfigurationError(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

  try {
    return await outboundCall({
      name: 's3',
      operation: async (signal) => {
        const client = getS3Client();
        const response = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            Range: `bytes=0-${maxBytes - 1}`,
          }),
          { abortSignal: signal },
        );
        const body = await response.Body?.transformToByteArray();
        if (!body) {
          throw new Error('s3.getObject.empty_body');
        }
        return {
          body: Buffer.from(body),
          contentType: response.ContentType,
        };
      },
    });
  } catch (error) {
    logger.error({ error, key, bucket }, 's3.getObjectLeadingBytes.failed');
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
  if (!bucket) throw new ConfigurationError(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

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
          // sec-U11: explicit SSE-S3 on every server-side write (audit cold
          // export, GDPR data-export, mail-outbox attachments). The bucket
          // default encryption is a defence in depth — request it directly so
          // a misconfigured bucket cannot silently land plaintext PII.
          ServerSideEncryption: 'AES256',
        }),
        { abortSignal: signal },
      );
    },
  });
}

/**
 * Server-side copy from `sourceKey` to `destinationKey` within the configured bucket.
 *
 * @remarks
 * - **Algorithm:** issues an S3 `CopyObject` request with `MetadataDirective: 'COPY'`
 *   (carries the original object's metadata) and pins `ServerSideEncryption: 'AES256'`
 *   on the destination so SSE-S3 stays in force regardless of bucket default
 *   (mirrors `s3-adapter.ts` and the sec-UP11 invariant). `ContentType` may be
 *   overridden by the caller — useful when the sweep auto-confirms an upload whose
 *   content-type was discovered after the initial PUT.
 * - **Failure modes:** propagates AWS errors to the caller (the sweep treats
 *   copy failure as a transient error and leaves the row for the next pass).
 * - **Side effects:** one PUT to the destination bucket; the source object is
 *   not deleted (callers may follow up with {@link deleteObject}).
 */
export async function copyObject(options: {
  sourceKey: string;
  destinationKey: string;
  contentType: string;
}): Promise<void> {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new ConfigurationError(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

  await outboundCall({
    name: 's3',
    operation: async (signal) => {
      const client = getS3Client();
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: options.destinationKey,
          CopySource: `${bucket}/${options.sourceKey}`,
          ContentType: options.contentType,
          MetadataDirective: 'COPY',
          ServerSideEncryption: 'AES256',
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
  if (!bucket) throw new ConfigurationError(S3_BUCKET_NOT_CONFIGURED_MESSAGE);

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
