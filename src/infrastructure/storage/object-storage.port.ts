/**
 * Subset of S3 `HeadObject` metadata that the upload domain trusts after a successful
 * `verifyUploadedObject` check. Either field may be `undefined` when the object exists
 * but the field is not surfaced (rare, e.g. some S3-compatible providers).
 */
export interface UploadedObjectMetadata {
  contentType: string | undefined;
  contentLength: number | undefined;
}

/** Browser-postable presigned upload: a form `url` plus hidden `fields` to submit with the file. */
export interface PresignedUploadPost {
  url: string;
  fields: Record<string, string>;
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

  /**
   * Presigned POST with a `content-length-range` policy so S3 itself rejects oversized or
   * empty uploads at upload time (stronger than a presigned PUT, which only signs a single
   * Content-Length). Returns the form action URL and the policy fields to submit.
   */
  createPresignedUploadPost(options: {
    key: string;
    contentType: string;
    minContentLength: number;
    maxContentLength: number;
    expiresInSeconds: number;
    metadata?: Record<string, string>;
  }): Promise<PresignedUploadPost>;

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
