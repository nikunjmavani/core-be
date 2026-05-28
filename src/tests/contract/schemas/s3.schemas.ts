import { z } from 'zod';

/** Parses an S3 presigned URL into a {@link URL} for query-parameter inspection in contract tests. */
export function parsePresignedAmazonWebServicesUrl(parameters: {
  presignedAbsoluteUrlString: string;
}): URL {
  return new URL(parameters.presignedAbsoluteUrlString);
}

/**
 * Builds a case-sensitive map of query parameters from a presigned S3 URL,
 * tolerating both modern percent-encoding and the legacy `+` space encoding
 * still emitted by some AWS SDK paths.
 */
export function normalizedPresignedQueryParameterMap(parameters: {
  amazonWebServicesSignedUrlObject: URL;
}): Map<string, string> {
  const queryParameterLookup = new Map<string, string>();
  for (const [key, value] of parameters.amazonWebServicesSignedUrlObject.searchParams.entries()) {
    queryParameterLookup.set(key, value);
  }
  const legacyPlusEncoding = decodeURIComponent(
    parameters.amazonWebServicesSignedUrlObject.search.slice(1),
  );
  for (const pair of legacyPlusEncoding.split('&')) {
    const [rawKey = '', rawValue = ''] = pair.split('=');
    if (!rawKey) continue;
    const decodedKey = decodeURIComponent(rawKey.replaceAll('+', ' '));
    const decodedValue = decodeURIComponent(rawValue.replaceAll('+', ' '));
    if (!queryParameterLookup.has(decodedKey)) queryParameterLookup.set(decodedKey, decodedValue);
  }
  return queryParameterLookup;
}

/** Zod contract for the response headers our storage adapter parses out of an S3 `HEAD object` call. */
export const HeadObjectSuccessfulResponseHeadersContractSchema = z.object({
  contentType: z.string(),
  contentLength: z.string(),
});
