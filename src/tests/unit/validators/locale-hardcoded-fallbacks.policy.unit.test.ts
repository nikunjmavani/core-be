import { describe, expect, it } from 'vitest';
import { findLocaleParityMismatches } from '@/scripts/validators/locale/locale-key-parity.util.js';
import { findHardcodedFallbackViolations } from '@/scripts/validators/locale/validate-locale-hardcoded-fallbacks.js';

describe('locale i18n policy', () => {
  it('has no hardcoded user-facing error fallbacks in application code', () => {
    expect(findHardcodedFallbackViolations()).toEqual([]);
  });

  it('has en/es parity for errors, success, common, and mail locale files', () => {
    expect(findLocaleParityMismatches()).toEqual([]);
  });
});
