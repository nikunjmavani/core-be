import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import {
  decryptFieldSecret,
  encryptFieldSecret,
} from '@/shared/utils/security/field-secret-encryption.util.js';

describe('field-secret-encryption.util', () => {
  const originalSecretsKey = process.env.SECRETS_ENCRYPTION_KEY;
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalSecretsKey === undefined) {
      delete process.env.SECRETS_ENCRYPTION_KEY;
    } else {
      process.env.SECRETS_ENCRYPTION_KEY = originalSecretsKey;
    }
    process.env.JWT_SECRET = originalJwtSecret ?? 'test-jwt-secret-for-field-encryption';
    resetEnvCacheForTests();
  });

  it('round-trips encrypted secrets with SECRETS_ENCRYPTION_KEY', () => {
    process.env.SECRETS_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    resetEnvCacheForTests();

    const plaintext = 'whsec_test_signing_key';
    const encrypted = encryptFieldSecret(plaintext);
    expect(encrypted).toMatch(/^v1:/);
    expect(decryptFieldSecret(encrypted)).toBe(plaintext);
  });

  it('returns legacy plaintext values unchanged', () => {
    process.env.SECRETS_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    resetEnvCacheForTests();

    expect(decryptFieldSecret('legacy-plaintext-secret')).toBe('legacy-plaintext-secret');
  });

  it('returns empty string without encrypting', () => {
    expect(encryptFieldSecret('')).toBe('');
  });

  it('throws when SECRETS_ENCRYPTION_KEY is unset', () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    resetEnvCacheForTests();

    expect(() => encryptFieldSecret('fallback-key')).toThrow(/SECRETS_ENCRYPTION_KEY/);
  });
});
