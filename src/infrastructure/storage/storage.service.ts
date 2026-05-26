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
 */
export function getObjectUrl(key: string): string {
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION ?? 'us-east-1';
  if (!bucket) throw new Error(S3_BUCKET_NOT_CONFIGURED_MESSAGE);
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * Verify an uploaded object exists and check its content type via HeadObject.
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
