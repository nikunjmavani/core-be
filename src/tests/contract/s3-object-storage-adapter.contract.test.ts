import { describe, expect, test } from 'vitest';
import nock from 'nock';

import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import { env } from '@/shared/config/env.config.js';

import headObjectOutboundMetadataFixture from './fixtures/s3/head-object.metadata.fixture.json' with {
  type: 'json',
};
import {
  normalizedPresignedQueryParameterMap,
  parsePresignedAmazonWebServicesUrl,
} from './schemas/s3.schemas.js';
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';

registerThirdPartyContractTestIsolationHooks();

/**
 * Contract test for the port-based S3ObjectStorageAdapter. The older s3.contract.test.ts
 * targets the function-style storage.service wrapper used by the audit export and the
 * tombstone retention worker. This test pins the adapter the upload domain depends on
 * (presigned POST, verifyUploadedObject, getObject) so signature drift in the AWS SDK
 * is caught at CI time.
 */
describe('Amazon S3 contract (`S3ObjectStorageAdapter`)', () => {
  const bucketOutbound = env.S3_BUCKET ?? 'contract-test-bucket';
  const regionOutbound = env.S3_REGION ?? 'us-east-1';
  const bucketHostnameOutbound = `${bucketOutbound}.s3.${regionOutbound}.amazonaws.com`;
  const objectKeySegmentsOutbound = headObjectOutboundMetadataFixture.s3EncodedObjectKeySegments;
  const objectKeyOutbound = objectKeySegmentsOutbound.join('/');
  const objectRequestPathOutbound = `/${objectKeyOutbound}`;

  test('createPresignedUploadPost returns a content-length-range policy and Content-Type field', async () => {
    const adapter = getDefaultS3ObjectStorageAdapter();

    const postResponse = await adapter.createPresignedUploadPost({
      key: objectKeyOutbound,
      contentType: 'image/png',
      minContentLength: 1,
      maxContentLength: 1024,
      expiresInSeconds: 300,
      metadata: { purpose: 'avatar' },
    });

    expect(postResponse.url).toMatch(/^https?:\/\//);
    expect(postResponse.fields).toHaveProperty('Content-Type', 'image/png');
    // SDK exposes the base64 policy under the capitalized field name `Policy`.
    expect(postResponse.fields).toHaveProperty('Policy');
    expect(postResponse.fields).toHaveProperty('key', objectKeyOutbound);
    // S3 SDK emits an x-amz-meta-* form field for every metadata entry the policy expects.
    expect(postResponse.fields).toHaveProperty('x-amz-meta-purpose', 'avatar');
  });

  test('createPresignedUploadUrl returns SigV4 PUT URL with deterministic bucket hostname', async () => {
    const adapter = getDefaultS3ObjectStorageAdapter();

    const presignedAbsoluteUrl = await adapter.createPresignedUploadUrl({
      key: objectKeyOutbound,
      contentType: 'application/pdf',
      contentLength: 1024,
      expiresInSeconds: 3600,
    });

    const presignedUrlObject = parsePresignedAmazonWebServicesUrl({
      presignedAbsoluteUrlString: presignedAbsoluteUrl,
    });

    expect(presignedUrlObject.hostname).toBe(bucketHostnameOutbound);
    expect(presignedUrlObject.pathname).toBe(objectRequestPathOutbound);

    const queryParameters = normalizedPresignedQueryParameterMap({
      amazonWebServicesSignedUrlObject: presignedUrlObject,
    });

    const algorithmKey = [...queryParameters.keys()].find((key) =>
      key.toLowerCase().endsWith('amz-algorithm'),
    );
    expect(algorithmKey).toBeDefined();
    expect(queryParameters.get(algorithmKey!)).toBe('AWS4-HMAC-SHA256');
  });

  test('verifyUploadedObject returns HEAD-reported contentType + contentLength', async () => {
    nock(`https://${bucketHostnameOutbound}`)
      .intercept(objectRequestPathOutbound, 'HEAD')
      .matchHeader('authorization', /^AWS4-HMAC-SHA256 Credential=/)
      .reply(Number(headObjectOutboundMetadataFixture.httpStatusSuccess), '', {
        'content-type': headObjectOutboundMetadataFixture.contentType,
        'content-length': headObjectOutboundMetadataFixture.contentLength,
      });

    const adapter = getDefaultS3ObjectStorageAdapter();
    const metadata = await adapter.verifyUploadedObject(objectKeyOutbound, {
      contentType: headObjectOutboundMetadataFixture.contentType,
      contentLength: Number(headObjectOutboundMetadataFixture.contentLength),
    });

    expect(metadata.contentType).toBe(headObjectOutboundMetadataFixture.contentType);
    expect(metadata.contentLength).toBe(Number(headObjectOutboundMetadataFixture.contentLength));
  });

  test('headObject returns null for missing objects (404 from S3)', async () => {
    nock(`https://${bucketHostnameOutbound}`)
      .intercept(objectRequestPathOutbound, 'HEAD')
      .reply(Number(headObjectOutboundMetadataFixture.httpStatusNotFound), '', {
        'content-type': 'application/xml',
      });

    const adapter = getDefaultS3ObjectStorageAdapter();
    await expect(adapter.headObject(objectKeyOutbound)).resolves.toBeNull();
  });

  test('getObject returns the body buffer and reported content type', async () => {
    const responseBody = Buffer.from('hello-world');
    // The AWS SDK appends an `?x-id=GetObject` query parameter; .query(true) accepts any.
    nock(`https://${bucketHostnameOutbound}`)
      .get(objectRequestPathOutbound)
      .query(true)
      .reply(200, responseBody, {
        'content-type': 'application/octet-stream',
        'content-length': String(responseBody.byteLength),
      });

    const adapter = getDefaultS3ObjectStorageAdapter();
    const result = await adapter.getObject(objectKeyOutbound);

    expect(result.body).toBeInstanceOf(Buffer);
    expect(result.body.equals(responseBody)).toBe(true);
    expect(result.contentType).toBe('application/octet-stream');
  });

  test('deleteObject returns true on a 204 No Content', async () => {
    // The AWS SDK appends an `?x-id=DeleteObject` query parameter; .query(true) accepts any.
    nock(`https://${bucketHostnameOutbound}`)
      .delete(objectRequestPathOutbound)
      .query(true)
      .reply(204, '');

    const adapter = getDefaultS3ObjectStorageAdapter();
    await expect(adapter.deleteObject(objectKeyOutbound)).resolves.toBe(true);
  });

  test('deleteObject returns false (and does not throw) when S3 returns 5xx', async () => {
    nock(`https://${bucketHostnameOutbound}`)
      .delete(objectRequestPathOutbound)
      .query(true)
      .times(3)
      .reply(500, '<Error><Code>InternalError</Code></Error>', {
        'content-type': 'application/xml',
      });

    const adapter = getDefaultS3ObjectStorageAdapter();
    await expect(adapter.deleteObject(objectKeyOutbound)).resolves.toBe(false);
  });
});
