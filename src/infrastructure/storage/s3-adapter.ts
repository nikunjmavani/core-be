import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { env } from '@/shared/config/env.config.js';
import { outboundCall } from '@/infrastructure/outbound/index.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
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
    });

    return getSignedUrl(getS3Client(), command, { expiresIn: options.expiresInSeconds });
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
        ...metadataConditions,
      ],
      Fields: {
        'Content-Type': options.contentType,
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
    const head = await this.headObject(key);
    if (!head) {
      throw new Error('upload object not found in storage');
    }

    if (head.contentType && head.contentType !== expected.contentType) {
      throw new Error('upload object content type mismatch');
    }

    if (head.contentLength !== undefined && head.contentLength !== expected.contentLength) {
      throw new Error('upload object content length mismatch');
    }

    return head;
  }

  getObjectUrl(key: string): string {
    const bucket = requireBucket();
    const region = env.S3_REGION ?? 'us-east-1';
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
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

  async headObject(
    key: string,
  ): Promise<{ contentType: string | undefined; contentLength: number | undefined } | null> {
    const bucket = requireBucket();

    try {
      return await outboundCall({
        name: 's3',
        operation: async (signal) => {
          const response = await getS3Client().send(
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
  if (!defaultAdapter) {
    defaultAdapter = new S3ObjectStorageAdapter();
  }
  return defaultAdapter;
}
