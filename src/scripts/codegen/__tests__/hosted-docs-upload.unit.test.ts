import { describe, expect, it } from 'vitest';
import {
  checkHostedUploadCredentials,
  shouldSkipHostedUpload,
} from '../hosted-docs-upload.util.js';

describe('hosted-docs-upload.util', () => {
  it('skips when any required credential is missing or blank', () => {
    const previousPostmanApiKey = process.env.POSTMAN_API_KEY;
    const previousPostmanWorkspaceId = process.env.POSTMAN_WORKSPACE_ID;

    delete process.env.POSTMAN_API_KEY;
    process.env.POSTMAN_WORKSPACE_ID = 'workspace-id';

    try {
      const check = checkHostedUploadCredentials(['POSTMAN_API_KEY', 'POSTMAN_WORKSPACE_ID']);
      expect(check.skip).toBe(true);
      expect(check.missingVariables).toEqual(['POSTMAN_API_KEY']);
    } finally {
      if (previousPostmanApiKey === undefined) {
        delete process.env.POSTMAN_API_KEY;
      } else {
        process.env.POSTMAN_API_KEY = previousPostmanApiKey;
      }
      if (previousPostmanWorkspaceId === undefined) {
        delete process.env.POSTMAN_WORKSPACE_ID;
      } else {
        process.env.POSTMAN_WORKSPACE_ID = previousPostmanWorkspaceId;
      }
    }
  });

  it('does not skip when all Scalar Registry credentials are set', () => {
    const previousScalarApiKey = process.env.SCALAR_API_KEY;
    const previousScalarNamespace = process.env.SCALAR_NAMESPACE;

    process.env.SCALAR_API_KEY = 'test-scalar-key';
    process.env.SCALAR_NAMESPACE = 'test-team';

    try {
      const check = checkHostedUploadCredentials(['SCALAR_API_KEY', 'SCALAR_NAMESPACE']);
      expect(check.skip).toBe(false);
      expect(check.missingVariables).toEqual([]);
      expect(
        shouldSkipHostedUpload('Scalar Registry', ['SCALAR_API_KEY', 'SCALAR_NAMESPACE']),
      ).toBe(false);
    } finally {
      if (previousScalarApiKey === undefined) {
        delete process.env.SCALAR_API_KEY;
      } else {
        process.env.SCALAR_API_KEY = previousScalarApiKey;
      }
      if (previousScalarNamespace === undefined) {
        delete process.env.SCALAR_NAMESPACE;
      } else {
        process.env.SCALAR_NAMESPACE = previousScalarNamespace;
      }
    }
  });
});
