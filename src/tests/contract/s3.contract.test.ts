import { describe, expect, test } from 'vitest';

import { createPresignedUploadUrl, headObject } from '@/infrastructure/storage/storage.service.js';
import { env } from '@/shared/config/env.config.js';

import headObjectOutboundMetadataFixture from './fixtures/s3/head-object.metadata.fixture.json' with {
  type: 'json',
};
import {
  normalizedPresignedQueryParameterMap,
  parsePresignedAmazonWebServicesUrl,
} from './schemas/s3.schemas.js';
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';
import nock from 'nock';

registerThirdPartyContractTestIsolationHooks();

function findAmazonWebServicesCanonicalQueryCaseInsensitiveOutbound(parameters: {
  lookupParametersNormalizedOutbound: Map<string, string>;
  canonicalQuerySuffixInsensitiveOutbound: string;
}): string | undefined {
  for (const [
    parameterKeyOutbound,
    canonicalQueryValueOutbound,
  ] of parameters.lookupParametersNormalizedOutbound.entries()) {
    const normalizedParameterKeyOutbound = parameterKeyOutbound.toLowerCase();
    if (
      normalizedParameterKeyOutbound.endsWith(parameters.canonicalQuerySuffixInsensitiveOutbound)
    ) {
      return canonicalQueryValueOutbound;
    }
  }
  return undefined;
}

describe('Amazon S3 contract (`storage.service`)', () => {
  const outboundObjectStorageFixtureBucketOutbound = env.S3_BUCKET ?? 'contract-test-bucket';
  const outboundAmazonWebServicesSdkRegionOutbound = env.S3_REGION ?? 'us-east-1';
  const outboundObjectStorageFixtureBucketHostname = `${outboundObjectStorageFixtureBucketOutbound}.s3.${outboundAmazonWebServicesSdkRegionOutbound}.amazonaws.com`;
  const outboundHeadObjectSegmentsArray =
    headObjectOutboundMetadataFixture.s3EncodedObjectKeySegments;
  const outboundHeadObjectSyntheticKeyOutbound = outboundHeadObjectSegmentsArray.join('/');
  const outboundHeadObjectSyntheticRequestPathOutbound = `/${outboundHeadObjectSyntheticKeyOutbound}`;

  test('createPresignedUploadUrl returns SigV4 query parameters with deterministic bucket hostname', async () => {
    const outboundPresignedUploadAbsoluteUrlOutbound = await createPresignedUploadUrl({
      key: outboundHeadObjectSyntheticKeyOutbound,
      contentType: 'application/pdf',
      expiresInSeconds: 3600,
    });

    const parsedPresignedOutboundUrlOutbound = parsePresignedAmazonWebServicesUrl({
      presignedAbsoluteUrlString: outboundPresignedUploadAbsoluteUrlOutbound,
    });

    expect(parsedPresignedOutboundUrlOutbound.hostname).toBe(
      outboundObjectStorageFixtureBucketHostname,
    );
    expect(parsedPresignedOutboundUrlOutbound.pathname).toBe(
      outboundHeadObjectSyntheticRequestPathOutbound,
    );

    const queryParametersNormalizedOutbound = normalizedPresignedQueryParameterMap({
      amazonWebServicesSignedUrlObject: parsedPresignedOutboundUrlOutbound,
    });

    const algorithmCanonicalQueryValueOutbound =
      findAmazonWebServicesCanonicalQueryCaseInsensitiveOutbound({
        lookupParametersNormalizedOutbound: queryParametersNormalizedOutbound,
        canonicalQuerySuffixInsensitiveOutbound: 'amz-algorithm',
      });

    expect(algorithmCanonicalQueryValueOutbound).toBe('AWS4-HMAC-SHA256');

    const signatureCanonicalQueryValueOutbound =
      findAmazonWebServicesCanonicalQueryCaseInsensitiveOutbound({
        lookupParametersNormalizedOutbound: queryParametersNormalizedOutbound,
        canonicalQuerySuffixInsensitiveOutbound: 'amz-signature',
      });

    expect(signatureCanonicalQueryValueOutbound?.length ?? 0).toBeGreaterThan(10);

    const expiresCanonicalQueryValueOutbound =
      findAmazonWebServicesCanonicalQueryCaseInsensitiveOutbound({
        lookupParametersNormalizedOutbound: queryParametersNormalizedOutbound,
        canonicalQuerySuffixInsensitiveOutbound: 'amz-expires',
      });

    expect(expiresCanonicalQueryValueOutbound).toBe('3600');

    const signedHeadersCanonicalOutboundValueRaw =
      findAmazonWebServicesCanonicalQueryCaseInsensitiveOutbound({
        lookupParametersNormalizedOutbound: queryParametersNormalizedOutbound,
        canonicalQuerySuffixInsensitiveOutbound: 'amz-signedheaders',
      });

    const signedHeadersOutboundLowercase =
      signedHeadersCanonicalOutboundValueRaw?.toLowerCase() ?? '';
    expect(
      signedHeadersOutboundLowercase.includes('content-type') ||
        signedHeadersOutboundLowercase.includes('host') ||
        signedHeadersOutboundLowercase.includes('range'),
    ).toBe(true);
  });

  test('headObject maps successful HeadObject XML headers onto typed fields', async () => {
    nock(`https://${outboundObjectStorageFixtureBucketHostname}`)
      .intercept(outboundHeadObjectSyntheticRequestPathOutbound, 'HEAD')
      .matchHeader('authorization', /^AWS4-HMAC-SHA256 Credential=/)
      .matchHeader('x-amz-date', /.*/)
      .reply(Number(headObjectOutboundMetadataFixture.httpStatusSuccess), '', {
        'content-type': headObjectOutboundMetadataFixture.contentType,
        'content-length': headObjectOutboundMetadataFixture.contentLength,
      });

    const headObjectOutboundResultPayload = await headObject(
      outboundHeadObjectSyntheticKeyOutbound,
    );

    expect(headObjectOutboundResultPayload).not.toBeNull();
    expect(headObjectOutboundResultPayload?.contentLength).toBe(
      Number(headObjectOutboundMetadataFixture.contentLength),
    );
    expect(headObjectOutboundResultPayload?.contentType).toBe(
      headObjectOutboundMetadataFixture.contentType,
    );
  });

  test('headObject returns null for missing objects while logging failures', async () => {
    nock(`https://${outboundObjectStorageFixtureBucketHostname}`)
      .intercept(outboundHeadObjectSyntheticRequestPathOutbound, 'HEAD')
      .reply(Number(headObjectOutboundMetadataFixture.httpStatusNotFound), '', {
        'content-type': 'application/xml',
      });

    await expect(headObject(outboundHeadObjectSyntheticKeyOutbound)).resolves.toBeNull();
  });
});
