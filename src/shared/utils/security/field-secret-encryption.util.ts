import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '@/shared/config/env.config.js';
import { AES_GCM_ALGORITHM, AES_GCM_IV_LENGTH } from '@/shared/constants/security.constants.js';

const ALGORITHM = AES_GCM_ALGORITHM;
const AUTH_TAG_LENGTH = 16;

/** Supported field-secret key versions, newest last. The stored prefix is `<version>:`. */
const SUPPORTED_VERSIONS = ['v1', 'v2'] as const;
type FieldSecretKeyVersion = (typeof SUPPORTED_VERSIONS)[number];

function isSupportedVersion(value: string): value is FieldSecretKeyVersion {
  return (SUPPORTED_VERSIONS as readonly string[]).includes(value);
}

/** Returns the `<version>` of a stored value's `<version>:` prefix, or `null` when unprefixed (corrupt/tampered — every real value is written prefixed). */
function parseVersionPrefix(stored: string): FieldSecretKeyVersion | null {
  const colonIndex = stored.indexOf(':');
  if (colonIndex <= 0) {
    return null;
  }
  const candidate = stored.slice(0, colonIndex);
  return isSupportedVersion(candidate) ? candidate : null;
}

/** Parses the optional `SECRETS_ENCRYPTION_KEYS` JSON map into version→key buffers (empty when unset). */
function parseFieldSecretKeyring(): Map<string, Buffer> {
  const raw = getEnv().SECRETS_ENCRYPTION_KEYS;
  if (!raw || raw.trim().length === 0) {
    return new Map();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      'SECRETS_ENCRYPTION_KEYS must be a JSON object mapping version to a 64-hex key',
    );
  }

  const keyring = new Map<string, Buffer>();
  for (const [version, hex] of Object.entries(parsed)) {
    if (typeof hex !== 'string') {
      continue;
    }
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error(`SECRETS_ENCRYPTION_KEYS["${version}"] must be 64 hex characters (32 bytes)`);
    }
    keyring.set(version, Buffer.from(hex, 'hex'));
  }
  return keyring;
}

/**
 * Resolves the AES-256-GCM key buffer for a given field-secret version. The optional
 * `SECRETS_ENCRYPTION_KEYS` keyring wins when it contains the version; otherwise `v1` falls back to
 * the single `SECRETS_ENCRYPTION_KEY` so deployments without a keyring behave exactly as before.
 */
function resolveFieldSecretEncryptionKey(version: FieldSecretKeyVersion): Buffer {
  const environment = getEnv();
  const keyring = parseFieldSecretKeyring();
  const keyForVersion = keyring.get(version);
  if (keyForVersion) {
    return keyForVersion;
  }

  if (version === 'v1') {
    if (environment.SECRETS_ENCRYPTION_KEY) {
      return Buffer.from(environment.SECRETS_ENCRYPTION_KEY, 'hex');
    }
    // Missing key is fatal in every runtime — field-secret encryption cannot proceed without it.
    // The env-schema high-entropy refine already enforces a strong key in production.
    throw new Error(
      'SECRETS_ENCRYPTION_KEY must be set (64 hex chars) for field-secret encryption',
    );
  }

  throw new Error(
    `SECRETS_ENCRYPTION_KEYS has no key for version "${version}" — add it before encrypting or decrypting "${version}:" values`,
  );
}

/**
 * Encrypts a short secret for at-rest storage (MFA seeds, webhook signing keys).
 *
 * @remarks
 * - Algorithm: AES-256-GCM with a random 12-byte IV; output is `<version>:base64(iv|authTag|cipher)`.
 * - The write version is `SECRETS_ENCRYPTION_CURRENT_VERSION` (default `v1`), letting operators cut
 *   over to a new key during a `SECRETS_ENCRYPTION_KEYS` rotation without touching existing rows.
 * - Failure modes: throws when no key is configured for the current version.
 * - Side effects: none (pure crypto over the resolved key).
 */
export function encryptFieldSecret(plaintext: string): string {
  if (plaintext.length === 0) {
    return plaintext;
  }
  const version = getEnv().SECRETS_ENCRYPTION_CURRENT_VERSION;
  const key = resolveFieldSecretEncryptionKey(version);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return `${version}:${payload.toString('base64')}`;
}

/**
 * Reverse of {@link encryptFieldSecret}. Fail-closed: a non-empty value that lacks a recognised
 * `<version>:` prefix throws, because every real secret is written prefixed by
 * {@link encryptFieldSecret} — an unprefixed non-empty value can only be corruption or tampering,
 * never trusted plaintext (audit greenfield cleanup). The empty string round-trips unchanged since
 * it is the canonical "no secret" representation (`encryptFieldSecret('')` returns `''`).
 *
 * @remarks
 * - Decrypts using the key for the value's OWN stored version, so values written under an older key
 *   stay readable after a newer current version is configured.
 * - Failure modes: throws when the value is a non-empty unencrypted string, when no key is
 *   configured for the stored version, or when the GCM auth tag fails (tampered ciphertext / wrong key).
 * - Side effects: none.
 */
export function decryptFieldSecret(stored: string): string {
  if (stored === '') {
    return stored;
  }
  const version = parseVersionPrefix(stored);
  if (!version) {
    throw new Error(
      'field-secret value is not encrypted: missing recognised <version>: prefix (corrupt or tampered)',
    );
  }
  const key = resolveFieldSecretEncryptionKey(version);
  const data = Buffer.from(stored.slice(version.length + 1), 'base64');
  const iv = data.subarray(0, AES_GCM_IV_LENGTH);
  const authTag = data.subarray(AES_GCM_IV_LENGTH, AES_GCM_IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(AES_GCM_IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
