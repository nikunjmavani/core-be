import { describe, expect, it } from 'vitest';
import { assertJwtKeyMaterial } from '@/shared/utils/security/jwt.util.js';

describe('assertJwtKeyMaterial', () => {
  it('resolves when the configured RS256 key material is valid', async () => {
    // The test runtime is provisioned with a valid RS256 keypair (see test setup / .env files),
    // so eagerly importing the signing + verification keys must succeed.
    await expect(assertJwtKeyMaterial()).resolves.toBeUndefined();
  });
});
