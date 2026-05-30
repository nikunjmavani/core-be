import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import {
  decryptFieldSecret,
  encryptFieldSecret,
} from '@/shared/utils/security/field-secret-encryption.util.js';

const KEY_V1 = '11'.repeat(32);
const KEY_V2 = '22'.repeat(32);

describe('field-secret-encryption.util', () => {
  const originalSecretsKey = process.env.SECRETS_ENCRYPTION_KEY;
  const originalSecretsKeys = process.env.SECRETS_ENCRYPTION_KEYS;
  const originalCurrentVersion = process.env.SECRETS_ENCRYPTION_CURRENT_VERSION;
  const originalJwtSecret = process.env.JWT_SECRET;

  function restoreEnvVar(name: string, original: string | undefined): void {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }

  afterEach(() => {
    restoreEnvVar('SECRETS_ENCRYPTION_KEY', originalSecretsKey);
    restoreEnvVar('SECRETS_ENCRYPTION_KEYS', originalSecretsKeys);
    restoreEnvVar('SECRETS_ENCRYPTION_CURRENT_VERSION', originalCurrentVersion);
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

  describe('versioned keyring rotation', () => {
    it('encrypts with the current version when a keyring is configured', () => {
      process.env.SECRETS_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1, v2: KEY_V2 });
      process.env.SECRETS_ENCRYPTION_CURRENT_VERSION = 'v2';
      resetEnvCacheForTests();

      const encrypted = encryptFieldSecret('totp-seed');
      expect(encrypted).toMatch(/^v2:/);
      expect(decryptFieldSecret(encrypted)).toBe('totp-seed');
    });

    it('decrypts a v1 value after the current version moves to v2 (overlap window)', () => {
      // Encrypt under v1 (current = v1) using the keyring's v1 key.
      process.env.SECRETS_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1, v2: KEY_V2 });
      process.env.SECRETS_ENCRYPTION_CURRENT_VERSION = 'v1';
      resetEnvCacheForTests();
      const v1Encrypted = encryptFieldSecret('rotating-secret');
      expect(v1Encrypted).toMatch(/^v1:/);

      // Cut over to v2 for new writes; v1 stays in the keyring for decryption.
      process.env.SECRETS_ENCRYPTION_CURRENT_VERSION = 'v2';
      resetEnvCacheForTests();
      expect(decryptFieldSecret(v1Encrypted)).toBe('rotating-secret');
      expect(encryptFieldSecret('rotating-secret')).toMatch(/^v2:/);
    });

    it('falls back to the single SECRETS_ENCRYPTION_KEY for v1 when no keyring is set', () => {
      delete process.env.SECRETS_ENCRYPTION_KEYS;
      delete process.env.SECRETS_ENCRYPTION_CURRENT_VERSION;
      process.env.SECRETS_ENCRYPTION_KEY = KEY_V1;
      resetEnvCacheForTests();

      const encrypted = encryptFieldSecret('legacy-path');
      expect(encrypted).toMatch(/^v1:/);
      expect(decryptFieldSecret(encrypted)).toBe('legacy-path');
    });

    it('decrypts a keyring v1 value using the single key fallback (same key material)', () => {
      // Value written by the single-key path...
      delete process.env.SECRETS_ENCRYPTION_KEYS;
      process.env.SECRETS_ENCRYPTION_KEY = KEY_V1;
      resetEnvCacheForTests();
      const encrypted = encryptFieldSecret('shared-v1');

      // ...is still decryptable once a keyring listing the same v1 key is introduced.
      process.env.SECRETS_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1, v2: KEY_V2 });
      resetEnvCacheForTests();
      expect(decryptFieldSecret(encrypted)).toBe('shared-v1');
    });

    it('throws when decrypting a version absent from the keyring', () => {
      process.env.SECRETS_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1, v2: KEY_V2 });
      process.env.SECRETS_ENCRYPTION_CURRENT_VERSION = 'v2';
      resetEnvCacheForTests();
      const v2Encrypted = encryptFieldSecret('orphan');

      // Drop v2 from the keyring; the stored value can no longer be decrypted.
      process.env.SECRETS_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1 });
      process.env.SECRETS_ENCRYPTION_CURRENT_VERSION = 'v1';
      resetEnvCacheForTests();
      expect(() => decryptFieldSecret(v2Encrypted)).toThrow(/version "v2"/);
    });
  });
});
