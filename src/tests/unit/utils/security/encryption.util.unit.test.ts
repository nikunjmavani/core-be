import { createDecipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptPayload } from '@/shared/utils/security/encryption.util.js';

const TEST_KEY_HEX = 'a'.repeat(64);

function decryptPayload(
  payload: string,
  ivBase64: string,
  authTagBase64: string,
  keyHex: string,
): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivBase64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));
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
    expect(first.authTag).toBeTruthy();
    expect(second.iv).not.toBe(first.iv);
    expect(second.payload).not.toBe(first.payload);
  });

  it('throws when key hex length is invalid for AES-256', () => {
    expect(() => encryptPayload('data', 'abcd')).toThrow();
  });

  it('round-trips decryption with AES-256-GCM', () => {
    const plaintext = '{"userId":"abc"}';
    const encrypted = encryptPayload(plaintext, TEST_KEY_HEX);
    const decrypted = decryptPayload(
      encrypted.payload,
      encrypted.iv,
      encrypted.authTag,
      TEST_KEY_HEX,
    );
    expect(decrypted).toBe(plaintext);
  });

  it('fails decryption when the auth tag is wrong (GCM integrity)', () => {
    const encrypted = encryptPayload('{"a":1}', TEST_KEY_HEX);
    const wrongTag = Buffer.alloc(16, 0).toString('base64'); // valid length, wrong tag
    expect(() => decryptPayload(encrypted.payload, encrypted.iv, wrongTag, TEST_KEY_HEX)).toThrow();
  });
});
