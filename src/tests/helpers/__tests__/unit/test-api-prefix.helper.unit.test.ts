import { describe, expect, it } from 'vitest';
import { TEST_API_V1_PREFIX, testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import {
  PUBLIC_API_VERSION_SEGMENT_V1,
  buildPublicApiPrefix,
} from '@/shared/utils/http/api-versioning.util.js';

describe('testApiPath', () => {
  it('builds paths from the shared public API prefix', () => {
    expect(TEST_API_V1_PREFIX).toBe(buildPublicApiPrefix(PUBLIC_API_VERSION_SEGMENT_V1));
    expect(testApiPath('/users/me')).toBe(`${TEST_API_V1_PREFIX}/users/me`);
    expect(testApiPath('billing/plans')).toBe(`${TEST_API_V1_PREFIX}/billing/plans`);
  });
});
