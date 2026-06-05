/**
 * Faker generators for the auth-webauthn bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** Generated passkey metadata for one `auth.webauthn_credentials` row. */
export interface BulkWebauthnProfile {
  /** Base64url-ish public key blob. */
  public_key: string;
  /** Signature counter. */
  counter: number;
  /** Authenticator device type (`singleDevice` / `multiDevice`). */
  device_type: string;
  /** Whether the credential is backed up (synced passkey). */
  backed_up: boolean;
  /** Supported client transports. */
  transports: string[];
}

const DEVICE_TYPES = ['singleDevice', 'multiDevice'] as const;
const TRANSPORTS = ['internal', 'usb', 'nfc', 'ble', 'hybrid'] as const;

/** Builds one fake passkey profile from the provided faker instance. */
export function generateBulkWebauthn(faker: Faker): BulkWebauthnProfile {
  const deviceType = faker.helpers.arrayElement(DEVICE_TYPES);
  return {
    public_key: faker.string.alphanumeric({ length: 64 }),
    counter: faker.number.int({ min: 0, max: 50 }),
    device_type: deviceType,
    backed_up: deviceType === 'multiDevice',
    transports: faker.helpers.arrayElements(TRANSPORTS, { min: 1, max: 2 }),
  };
}
