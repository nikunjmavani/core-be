import { createCipheriv, randomBytes } from 'node:crypto';
import { AES_GCM_ALGORITHM, AES_GCM_IV_LENGTH } from '@/shared/constants/security.constants.js';

const ALGORITHM = AES_GCM_ALGORITHM;

/** AES-256-GCM ciphertext, IV, and authentication tag (all base64); returned by {@link encryptPayload}. */
export interface EncryptedPayload {
  payload: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypt a plaintext string with AES-256-GCM (authenticated encryption).
 *
 * A fresh random 12-byte IV is generated per call so identical plaintexts produce
 * different ciphertexts. The returned `authTag` (GCM tag) must be supplied to the
 * decryptor, which fails if the ciphertext, IV, or tag was tampered with.
 *
 * Client-side decryption (Web Crypto, browser — crypto-js does not support GCM):
 * ```js
 * const rawKey = Uint8Array.from(keyHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
 * const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
 * const iv  = Uint8Array.from(atob(response.iv), (c) => c.charCodeAt(0));
 * const ct  = Uint8Array.from(atob(response.payload), (c) => c.charCodeAt(0));
 * const tag = Uint8Array.from(atob(response.authTag), (c) => c.charCodeAt(0));
 * const data = new Uint8Array([...ct, ...tag]); // Web Crypto expects ciphertext || tag
 * const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
 * JSON.parse(new TextDecoder().decode(plain));
 * ```
 */
export function encryptPayload(plaintext: string, keyHex: string): EncryptedPayload {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(AES_GCM_IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    payload: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}
