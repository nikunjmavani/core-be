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

  /**
   * Server-side copy of an existing object to a new key (no bytes transit the app). Used by the
   * upload confirm step to publish a verified pending object to its immutable final key so the
   * served object can never be overwritten via the client's still-valid presigned upload URL. The
   * destination `contentType` is set on the copy so the served object carries the verified type.
   * `sourceETag` (sec-re-10) is the S3 ETag captured at the verify step; when supplied the
   * adapter passes it as `CopySourceIfMatch` so the COPY fails with `PreconditionFailed` if the
   * source bytes changed between verify and copy (closes the pending-PUT replay TOCTOU window).
   */
  copyObject(options: {
    sourceKey: string;
    destinationKey: string;
    contentType: string;
    sourceETag?: string;
  }): Promise<void>;

  getObject(key: string): Promise<{ body: Buffer; contentType: string | undefined }>;

  /**
   * Fetches the first `byteCount` bytes of an S3 object via a ranged GET. Used for magic-byte
   * verification so large uploads are not fully buffered in the process. Returns `null` on
   * S3 errors (logged internally); throws when `S3_BUCKET` is unset. `eTag` (sec-re-10) is the
   * S3 ETag of the object at the time of read; callers thread it into `copyObject` to close
   * the verify→copy TOCTOU window.
   */
  getObjectFirstBytes(
    key: string,
    byteCount: number,
  ): Promise<{ body: Buffer; contentType: string | undefined; eTag?: string } | null>;

  getObjectUrl(key: string): string;

  createPresignedDownloadUrl(options: { key: string; expiresInSeconds: number }): Promise<string>;
}
