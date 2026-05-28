import { createCipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/** AES-256-CBC ciphertext + IV, both base64-encoded; returned by {@link encryptPayload} and consumed by client-side decryption. */
export interface EncryptedPayload {
  payload: string;
  iv: string;
}

/**
 * Encrypt a plaintext string with AES-256-CBC.
 *
 * A fresh random 16-byte IV is generated per call so identical plaintexts
 * produce different ciphertexts.
 *
 * Client-side decryption (crypto-js, browser):
 * ```js
 * const key = CryptoJS.enc.Hex.parse(keyHex);
 * const iv  = CryptoJS.enc.Base64.parse(response.iv);
 * const decrypted = CryptoJS.AES.decrypt(response.payload, key, {
 *   iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
 * });
 * JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
 * ```
 */
export function encryptPayload(plaintext: string, keyHex: string): EncryptedPayload {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  return {
    payload: encrypted,
    iv: iv.toString('base64'),
  };
}
