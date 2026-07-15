import { describe, expect, it } from 'vitest';
import { findLocaleParityMismatches } from '@/scripts/validators/locale/locale-key-parity.util.js';
import { findHardcodedFallbackViolations } from '@/scripts/validators/locale/validate-locale-hardcoded-fallbacks.js';
import {
  findUndefinedKeyReferences,
  loadDefinedKeys,
} from '@/scripts/validators/locale/locale-key-usage.util.js';

describe('locale i18n policy', () => {
  it('has no hardcoded user-facing error fallbacks in application code', () => {
    expect(findHardcodedFallbackViolations()).toEqual([]);
  });

  it('has en/es parity for errors, success, common, and mail locale files', () => {
    expect(findLocaleParityMismatches()).toEqual([]);
  });

  it('has no i18n key referenced in runtime code but missing from the locale JSON', () => {
    // A referenced-but-undefined key renders as the raw `errors:foo` string to users (returnNull:
    // false + parseMissingKeyHandler returns the key). Parity cannot catch a key absent from BOTH
    // locales; this closes that gap.
    expect(findUndefinedKeyReferences()).toEqual([]);
  });

  it('defines every messageKey the WebAuthn + auth-method-id throw sites use', () => {
    // Regression guard: these keys were thrown but never added to errors.json, so passkey ceremony
    // failures leaked the raw key. Keep them defined as long as the code throws them.
    const defined = loadDefinedKeys();
    for (const key of [
      'errors:webauthnInvalidChallenge',
      'errors:webauthnAuthenticationFailed',
      'errors:webauthnCredentialNotFound',
      'errors:webauthnRegistrationFailed',
      'errors:validation.invalidAuthMethodId',
      'errors:validation.invalidPagination',
    ]) {
      expect(defined).toContain(key);
    }
  });
});
