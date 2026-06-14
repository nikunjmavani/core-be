import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { env } from '@/shared/config/env.config.js';
import { outboundCall } from '@/infrastructure/outbound/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { type S3HeadResult, isS3NotFoundError } from '@/infrastructure/storage/s3-error.util.js';
import { buildPublicMediaUrl } from '@/infrastructure/storage/public-media-url.util.js';
import type {
  ObjectStoragePort,
  PresignedUploadPost,
  UploadedObjectMetadata,
} from '@/infrastructure/storage/object-storage.port.js';

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

function requireBucket(): string {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is not configured');
  return bucket;
}

/** Default S3 implementation of {@link ObjectStoragePort}. */
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  /**
   * Presigned PUT URL bound to an exact `Content-Length`. `content-length` is forced into
   * the SigV4 signed headers so S3 rejects any request whose body length differs from the
   * value declared (and validated `<= UPLOAD_PURPOSE_CONFIG.maxSize`) at create time — this
   * is the strongest size constraint a presigned PUT supports. For an explicit min/max range
   * prefer the presigned POST flow (`UPLOAD_USE_PRESIGNED_POST=true`, recommended for
   * production); see {@link createPresignedUploadPost}.
   */
  async createPresignedUploadUrl(options: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<string> {
    const bucket = requireBucket();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: options.key,
      ContentType: options.contentType,
      ContentLength: options.contentLength,
      // sec-r4-E1: require SSE-S3 on the uploaded object. The bucket default
      // is defence-in-depth; binding the requirement into the presigned URL
      // also forces the client to send `x-amz-server-side-encryption: AES256`,
      // so a misconfigured bucket cannot accept an unencrypted upload via
      // this presigned URL.
      ServerSideEncryption: 'AES256',
    });

    return getSignedUrl(getS3Client(), command, {
      expiresIn: options.expiresInSeconds,
      // sec-r4-E1: include the SSE header in the signed-headers set so the
      // signature is invalidated if the client strips or rewrites it.
      signableHeaders: new Set([
        'content-length',
        'content-type',
        'host',
        'x-amz-server-side-encryption',
      ]),
    });
  }

  async createPresignedUploadPost(options: {
    key: string;
    contentType: string;
    minContentLength: number;
    maxContentLength: number;
    expiresInSeconds: number;
    metadata?: Record<string, string>;
  }): Promise<PresignedUploadPost> {
    const bucket = requireBucket();
    const metadataConditions = Object.entries(options.metadata ?? {}).map(
      ([metadataKey, value]) => ({ [`x-amz-meta-${metadataKey}`]: value }),
    );
    const { url, fields } = await createPresignedPost(getS3Client(), {
      Bucket: bucket,
      Key: options.key,
      Conditions: [
        ['content-length-range', options.minContentLength, options.maxContentLength],
        ['eq', '$Content-Type', options.contentType],
        // sec-r4-E1: enforce AES256 server-side encryption on the uploaded
        // object via a POST policy condition so the browser form must include
        // the header and S3 rejects anything else.
        ['eq', '$x-amz-server-side-encryption', 'AES256'],
        ...metadataConditions,
      ],
      Fields: {
        'Content-Type': options.contentType,
        // sec-r4-E1: pre-populate the SSE field so a vanilla form upload
        // satisfies the condition above without the client having to add it.
        'x-amz-server-side-encryption': 'AES256',
        ...Object.fromEntries(
          Object.entries(options.metadata ?? {}).map(([metadataKey, value]) => [
            `x-amz-meta-${metadataKey}`,
            value,
          ]),
        ),
      },
      Expires: options.expiresInSeconds,
    });
    return { url, fields };
  }

  async verifyUploadedObject(
    key: string,
    expected: { contentType: string; contentLength: number },
  ): Promise<UploadedObjectMetadata> {
    const head = await this.headObjectResult(key);
    // audit-#5: a transient storage failure must NOT look like a verification failure. Re-throw
    // the underlying ExternalServiceError (503, retryable) so the confirm path leaves the upload
    // PENDING/retryable instead of marking a perfectly valid object FAILED.
    if (head.kind === 'transient_error') {
      throw head.cause instanceof Error
        ? head.cause
        : new Error('upload object head transient error');
    }
    if (head.kind === 'not_found') {
      throw new Error('upload object not found in storage');
    }

    const metadata = head.metadata;
    if (metadata.contentType && metadata.contentType !== expected.contentType) {
      throw new Error('upload object content type mismatch');
    }

    if (metadata.contentLength !== undefined && metadata.contentLength !== expected.contentLength) {
      throw new Error('upload object content length mismatch');
    }

    return metadata;
  }

  getObjectUrl(key: string): string {
    // audit-#13: refuse public URLs for non-public-media keys and prefer the PUBLIC_MEDIA_BASE_URL
    // distribution so the bucket can keep Block-Public-Access on (private files stay presigned-only).
    return buildPublicMediaUrl(key, {
      bucket: env.S3_BUCKET,
      region: env.S3_REGION ?? 'us-east-1',
    });
  }

  async createPresignedDownloadUrl(options: {
    key: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const bucket = requireBucket();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: options.key,
    });
    return getSignedUrl(getS3Client(), command, { expiresIn: options.expiresInSeconds });
  }

  /**
   * Discriminated `HeadObject` (audit-#5): distinguishes `found` / `not_found` /
   * `transient_error` so callers never treat an outage as object absence. Only an explicit
   * `NoSuchKey`/404 maps to `not_found`; every other failure (timeout, throttle, circuit-open,
   * IAM denial, 5xx) is a `transient_error` carrying the original cause for the caller to retry.
   */
  async headObjectResult(key: string): Promise<S3HeadResult<UploadedObjectMetadata>> {
    const bucket = requireBucket();
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

  async headObject(
    key: string,
  ): Promise<{ contentType: string | undefined; contentLength: number | undefined } | null> {
    const result = await this.headObjectResult(key);
    if (result.kind === 'transient_error') throw result.cause;
    return result.kind === 'found' ? result.metadata : null;
  }

  async getObject(key: string): Promise<{ body: Buffer; contentType: string | undefined }> {
    const bucket = requireBucket();

    return outboundCall({
      name: 's3',
      operation: async (signal) => {
        const response = await getS3Client().send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
          { abortSignal: signal },
        );

        const body = await response.Body?.transformToByteArray();
        if (!body) {
          throw new Error('upload object body empty');
        }

        return {
          body: Buffer.from(body),
          contentType: response.ContentType,
        };
      },
    });
  }

  async getObjectFirstBytes(
    key: string,
    byteCount: number,
  ): Promise<{
    body: Buffer;
    contentType: string | undefined;
    /**
     * S3 object ETag at the time the magic-byte HEAD was read. sec-re-10:
     * the caller threads this back into {@link copyObject} as
     * `CopySourceIfMatch` so S3 rejects the COPY with `PreconditionFailed`
     * when an attacker replays the presigned PUT/POST between the
     * verify and the copy, replacing the verified bytes with hostile
     * content. May be omitted on unversioned mocks; the caller treats a
     * missing ETag as the legacy unprotected path.
     */
    eTag?: string;
  } | null> {
    const bucket = requireBucket();
    try {
      return await outboundCall({
        name: 's3',
        operation: async (signal) => {
          const response = await getS3Client().send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: key,
              Range: `bytes=0-${byteCount - 1}`,
            }),
            { abortSignal: signal },
          );
          const body = await response.Body?.transformToByteArray();
          if (!body) {
            throw new Error('upload object body empty');
          }
          return {
            body: Buffer.from(body),
            contentType: response.ContentType,
            // `exactOptionalPropertyTypes` distinguishes "key absent" from
            // "key present with value undefined"; spread the eTag only when
            // S3 actually returned one so the optional field stays absent
            // for the legacy unprotected path.
            ...(response.ETag ? { eTag: response.ETag } : {}),
          };
        },
      });
    } catch (error) {
      if (isS3NotFoundError(error)) {
        logger.warn({ key, bucket }, 's3.getObjectFirstBytes.not_found');
        return null;
      }
      logger.error({ error, key, bucket }, 's3.getObjectFirstBytes.transient_failure');
      throw error;
    }
  }

  async putObject(options: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    const bucket = requireBucket();
    await outboundCall({
      name: 's3',
      operation: async (signal) => {
        await getS3Client().send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: options.key,
            Body: options.body,
            ContentType: options.contentType,
            Metadata: options.metadata,
            // sec-U11: explicit SSE-S3 request — bucket default encryption is
            // a defence in depth; explicit at the call site protects against
            // misconfigured buckets that lack a default and would otherwise
            // store payloads (avatars, uploads, audit copies) unencrypted.
            ServerSideEncryption: 'AES256',
          }),
          { abortSignal: signal },
        );
      },
    });
  }

  async copyObject(options: {
    sourceKey: string;
    destinationKey: string;
    contentType: string;
    /**
     * Optional S3 ETag from the source object. sec-re-10: when supplied,
     * passed to S3 as `CopySourceIfMatch` so the COPY fails with
     * `PreconditionFailed` if the source bytes changed since the caller
     * inspected them — closing the TOCTOU window between the magic-byte
     * verify on `pending/<key>` and the copy to the servable key for the
     * ~15 minutes the presigned PUT remains replayable.
     */
    sourceETag?: string;
  }): Promise<void> {
    const bucket = requireBucket();
    await outboundCall({
      name: 's3',
      operation: async (signal) => {
        await getS3Client().send(
          new CopyObjectCommand({
            Bucket: bucket,
            // CopySource is `<bucket>/<key>`; our keys use only URL-safe path characters.
            CopySource: `${bucket}/${options.sourceKey}`,
            Key: options.destinationKey,
            ContentType: options.contentType,
            MetadataDirective: 'REPLACE',
            // sec-U11: explicit SSE-S3 on the destination object so a copy
            // does not bypass the encryption requirement if the bucket
            // default is misconfigured.
            ServerSideEncryption: 'AES256',
            ...(options.sourceETag ? { CopySourceIfMatch: options.sourceETag } : {}),
          }),
          { abortSignal: signal },
        );
      },
    });
  }

  async deleteObject(key: string): Promise<boolean> {
    const bucket = requireBucket();

    try {
      await outboundCall({
        name: 's3',
        operation: async (signal) => {
          await getS3Client().send(
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
}

let defaultAdapter: S3ObjectStorageAdapter | null = null;

/**
 * Returns the process-wide {@link S3ObjectStorageAdapter} singleton (instantiated on
 * first call). DI containers should depend on {@link ObjectStoragePort} and accept this
 * factory as the production binding; tests can supply a fake port instead.
 */
export function getDefaultS3ObjectStorageAdapter(): S3ObjectStorageAdapter {
  defaultAdapter ??= new S3ObjectStorageAdapter();
  return defaultAdapter;
}
