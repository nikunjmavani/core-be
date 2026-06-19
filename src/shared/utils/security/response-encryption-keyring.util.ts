import { env } from '@/shared/config/env.config.js';

/** Supported response-encryption key versions, newest last. Stamped into the envelope as `kid`. */
const SUPPORTED_VERSIONS = ['v1', 'v2'] as const;
type ResponseEncryptionKeyVersion = (typeof SUPPORTED_VERSIONS)[number];

function isSupportedVersion(value: string): value is ResponseEncryptionKeyVersion {
  return (SUPPORTED_VERSIONS as readonly string[]).includes(value);
}

/** Parses the optional `RESPONSE_ENCRYPTION_KEYS` JSON map into version→hex (empty when unset). */
function parseResponseEncryptionKeyring(): Map<string, string> {
  const raw = env.RESPONSE_ENCRYPTION_KEYS;
  if (!raw || raw.trim().length === 0) {
    return new Map();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      'RESPONSE_ENCRYPTION_KEYS must be a JSON object mapping version to a 64-hex key',
    );
  }

  const keyring = new Map<string, string>();
  for (const [version, hex] of Object.entries(parsed)) {
    if (typeof hex !== 'string') {
      continue;
    }
    if (!/^[0-9a-f]{64}$/i.test(hex)) {
      throw new Error(
        `RESPONSE_ENCRYPTION_KEYS["${version}"] must be 64 hex characters (32 bytes)`,
      );
    }
    keyring.set(version, hex);
  }
  return keyring;
}

/** Active response-encryption write key: the `kid` stamped into the envelope and its 64-hex key. */
export interface ActiveResponseEncryptionKey {
  kid: ResponseEncryptionKeyVersion;
  keyHex: string;
}

/**
 * Resolves the active AES-256-GCM write key (and its `kid`) for the response-encryption envelope.
 *
 * @remarks
 * - **Algorithm:** the write version is `RESPONSE_ENCRYPTION_CURRENT_VERSION` (default `v1`). The
 *   optional `RESPONSE_ENCRYPTION_KEYS` keyring wins when it contains that version; otherwise `v1`
 *   falls back to the single `RESPONSE_ENCRYPTION_KEY` so deployments without a keyring behave
 *   exactly as before (now stamped `kid: 'v1'`).
 * - **Rotation:** add the new key to `RESPONSE_ENCRYPTION_KEYS`, ship its `kid`→key to clients, then
 *   flip `RESPONSE_ENCRYPTION_CURRENT_VERSION`. The `kid` in each envelope tells the client which key
 *   to decrypt with, so old and new clients coexist during the rollout.
 * - **Failure modes:** throws (at middleware registration / boot) when no key is configured for the
 *   current version or when the keyring JSON is malformed.
 * - **Side effects:** none (reads env, parses the keyring).
 */
export function resolveActiveResponseEncryptionKey(): ActiveResponseEncryptionKey {
  const rawVersion = env.RESPONSE_ENCRYPTION_CURRENT_VERSION ?? 'v1';
  const version = isSupportedVersion(rawVersion) ? rawVersion : 'v1';

  const keyForVersion = parseResponseEncryptionKeyring().get(version);
  if (keyForVersion) {
    return { kid: version, keyHex: keyForVersion };
  }

  if (version === 'v1' && env.RESPONSE_ENCRYPTION_KEY) {
    return { kid: 'v1', keyHex: env.RESPONSE_ENCRYPTION_KEY };
  }

  throw new Error(
    `RESPONSE_ENCRYPTION_KEYS has no key for version "${version}" — add it (or set RESPONSE_ENCRYPTION_KEY for v1) before enabling response encryption`,
  );
}
