import { createDecipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload } from '@/shared/utils/security/encryption.util.js';

const TEST_KEY_HEX = 'a'.repeat(64);

function decryptPayload(payload: string, ivBase64: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivBase64, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(payload, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

describe('encryption.util', () => {
  it('encrypts plaintext and produces distinct IV per call', () => {
    const plaintext = JSON.stringify({ secret: 'value' });
    const first = encryptPayload(plaintext, TEST_KEY_HEX);
    const second = encryptPayload(plaintext, TEST_KEY_HEX);

    expect(first.payload).toBeTruthy();
    expect(first.iv).toBeTruthy();
    expect(second.iv).not.toBe(first.iv);
    expect(second.payload).not.toBe(first.payload);
  });

  it('throws when key hex length is invalid for AES-256', () => {
    expect(() => encryptPayload('data', 'abcd')).toThrow();
  });

  it('round-trips decryption with AES-256-CBC', () => {
    const plaintext = '{"userId":"abc"}';
    const encrypted = encryptPayload(plaintext, TEST_KEY_HEX);
    const decrypted = decryptPayload(encrypted.payload, encrypted.iv, TEST_KEY_HEX);
    expect(decrypted).toBe(plaintext);
  });
});
