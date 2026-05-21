import { describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION_PREFIX = 'v1:';

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return `${VERSION_PREFIX}${payload.toString('base64')}`;
}

function decryptWithKey(stored: string, key: Buffer): string {
  const data = Buffer.from(stored.slice(VERSION_PREFIX.length), 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

describe('rotate-field-secrets crypto round-trip', () => {
  it('re-encrypts with a new key when from-key is provided', () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const plaintext = 'totp-secret-value';
    const encryptedWithOld = encryptWithKey(plaintext, oldKey);
    const roundTrip = decryptWithKey(encryptedWithOld, oldKey);
    const encryptedWithNew = encryptWithKey(roundTrip, newKey);
    expect(decryptWithKey(encryptedWithNew, newKey)).toBe(plaintext);
  });
});
