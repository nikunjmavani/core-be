import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveActiveResponseEncryptionKey } from '@/shared/utils/security/response-encryption-keyring.util.js';

const keyringTestEnv = vi.hoisted(() => ({
  RESPONSE_ENCRYPTION_KEY: undefined as string | undefined,
  RESPONSE_ENCRYPTION_KEYS: undefined as string | undefined,
  RESPONSE_ENCRYPTION_CURRENT_VERSION: 'v1' as 'v1' | 'v2',
}));

vi.mock('@/shared/config/env.config.js', () => ({
  env: {
    get RESPONSE_ENCRYPTION_KEY() {
      return keyringTestEnv.RESPONSE_ENCRYPTION_KEY;
    },
    get RESPONSE_ENCRYPTION_KEYS() {
      return keyringTestEnv.RESPONSE_ENCRYPTION_KEYS;
    },
    get RESPONSE_ENCRYPTION_CURRENT_VERSION() {
      return keyringTestEnv.RESPONSE_ENCRYPTION_CURRENT_VERSION;
    },
  },
}));

const KEY_V1 = 'a'.repeat(64);
const KEY_V2 = 'b'.repeat(64);

describe('resolveActiveResponseEncryptionKey', () => {
  beforeEach(() => {
    keyringTestEnv.RESPONSE_ENCRYPTION_KEY = undefined;
    keyringTestEnv.RESPONSE_ENCRYPTION_KEYS = undefined;
    keyringTestEnv.RESPONSE_ENCRYPTION_CURRENT_VERSION = 'v1';
  });

  it('falls back to the single RESPONSE_ENCRYPTION_KEY as kid v1 when no keyring is set', () => {
    keyringTestEnv.RESPONSE_ENCRYPTION_KEY = KEY_V1;
    expect(resolveActiveResponseEncryptionKey()).toEqual({ kid: 'v1', keyHex: KEY_V1 });
  });

  it('uses the keyring key for the current version', () => {
    keyringTestEnv.RESPONSE_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1, v2: KEY_V2 });
    keyringTestEnv.RESPONSE_ENCRYPTION_CURRENT_VERSION = 'v2';
    expect(resolveActiveResponseEncryptionKey()).toEqual({ kid: 'v2', keyHex: KEY_V2 });
  });

  it('prefers the keyring over the single key for v1', () => {
    keyringTestEnv.RESPONSE_ENCRYPTION_KEY = KEY_V1;
    keyringTestEnv.RESPONSE_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V2 });
    expect(resolveActiveResponseEncryptionKey()).toEqual({ kid: 'v1', keyHex: KEY_V2 });
  });

  it('throws when the current version has no configured key', () => {
    keyringTestEnv.RESPONSE_ENCRYPTION_KEYS = JSON.stringify({ v1: KEY_V1 });
    keyringTestEnv.RESPONSE_ENCRYPTION_CURRENT_VERSION = 'v2';
    expect(() => resolveActiveResponseEncryptionKey()).toThrow(/no key for version "v2"/);
  });

  it('throws on malformed keyring JSON', () => {
    keyringTestEnv.RESPONSE_ENCRYPTION_KEYS = '{not-json';
    expect(() => resolveActiveResponseEncryptionKey()).toThrow(/must be a JSON object/);
  });

  it('throws when a keyring value is not 64 hex characters', () => {
    keyringTestEnv.RESPONSE_ENCRYPTION_KEYS = JSON.stringify({ v1: 'tooshort' });
    expect(() => resolveActiveResponseEncryptionKey()).toThrow(/64 hex characters/);
  });
});
