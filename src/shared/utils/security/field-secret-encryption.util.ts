import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '@/shared/config/env.config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION_PREFIX = 'v1:';

function resolveFieldSecretEncryptionKey(): Buffer {
  const environment = getEnv();
  if (environment.SECRETS_ENCRYPTION_KEY) {
    return Buffer.from(environment.SECRETS_ENCRYPTION_KEY, 'hex');
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error('SECRETS_ENCRYPTION_KEY is required in production');
  }
  throw new Error(
    'SECRETS_ENCRYPTION_KEY must be set (64 hex chars) for field-secret encryption in non-production',
  );
}

function isEncryptedFieldSecret(value: string): boolean {
  return value.startsWith(VERSION_PREFIX);
}

/**
 * Encrypts a short secret for at-rest storage (MFA seeds, webhook signing keys).
 * Legacy plaintext values are still readable via decryptFieldSecret.
 */
export function encryptFieldSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    return plaintext;
  }
  const key = resolveFieldSecretEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return `${VERSION_PREFIX}${payload.toString('base64')}`;
}

export function decryptFieldSecret(stored: string): string {
  if (!isEncryptedFieldSecret(stored)) {
    return stored;
  }
  const key = resolveFieldSecretEncryptionKey();
  const data = Buffer.from(stored.slice(VERSION_PREFIX.length), 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
