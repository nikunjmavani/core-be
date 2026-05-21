export interface UploadedObjectMetadata {
  contentType: string | undefined;
  contentLength: number | undefined;
}

/**
 * Port for object storage (S3-compatible). Domain upload code depends on this abstraction.
 */
export interface ObjectStoragePort {
  createPresignedUploadUrl(options: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<string>;

  verifyUploadedObject(
    key: string,
    expected: { contentType: string; contentLength: number },
  ): Promise<UploadedObjectMetadata>;

  headObject(
    key: string,
  ): Promise<{ contentType: string | undefined; contentLength: number | undefined } | null>;

  deleteObject(key: string): Promise<boolean>;

  putObject(options: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<void>;

  getObject(key: string): Promise<{ body: Buffer; contentType: string | undefined }>;

  getObjectUrl(key: string): string;

  createPresignedDownloadUrl(options: { key: string; expiresInSeconds: number }): Promise<string>;
}
