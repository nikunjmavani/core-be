import { z } from 'zod';

export function parsePresignedAmazonWebServicesUrl(parameters: {
  presignedAbsoluteUrlString: string;
}): URL {
  return new URL(parameters.presignedAbsoluteUrlString);
}

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

export const HeadObjectSuccessfulResponseHeadersContractSchema = z.object({
  contentType: z.string(),
  contentLength: z.string(),
});
