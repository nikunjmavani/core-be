import { ExternalServiceError } from '@/infrastructure/outbound/index.js';

/**
 * Discriminated result of an S3 `HeadObject` call (audit-#5).
 *
 * @remarks
 * The previous wrappers collapsed every failure to `null`, conflating an explicit
 * `NoSuchKey`/404 with a timeout, throttle, circuit-open, or IAM denial. Callers then made
 * irreversible decisions (mark an upload `FAILED`, hard-delete an orphan row) on what was
 * really a transient outage. This result forces callers to branch on the real cause so only
 * an explicit not-found can drive destructive cleanup.
 */
export type S3HeadResult<TMetadata> =
  | { kind: 'found'; metadata: TMetadata }
  | { kind: 'not_found' }
  | { kind: 'transient_error'; cause: unknown };

/**
 * True only when `error` is an explicit S3 "object does not exist" response (`NotFound` /
 * `NoSuchKey` / HTTP 404), unwrapping an {@link ExternalServiceError} produced by `outboundCall`
 * to inspect the original AWS SDK error on `cause`.
 *
 * @remarks
 * - **Algorithm:** checks the error and (when wrapped) its `cause` for the AWS SDK not-found
 *   signatures: `name`/`Code` of `NotFound`/`NoSuchKey`, or `$metadata.httpStatusCode === 404`.
 * - **Failure modes:** returns `false` for any non-object value and for every transient signature
 *   (timeout, network, circuit-open, throttling, 5xx) so those are never treated as not-found.
 */
export function isS3NotFoundError(error: unknown): boolean {
  const candidates: unknown[] = [error];
  if (error instanceof ExternalServiceError && error.cause !== undefined) {
    candidates.push(error.cause);
  }
  return candidates.some(matchesS3NotFoundSignature);
}

function matchesS3NotFoundSignature(candidate: unknown): boolean {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }
  const error = candidate as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    error.name === 'NotFound' ||
    error.name === 'NoSuchKey' ||
    error.Code === 'NotFound' ||
    error.Code === 'NoSuchKey' ||
    error.$metadata?.httpStatusCode === 404
  );
}
