import { describe, expect, it } from 'vitest';
import {
  detectTier,
  isExemptFromTierSuffix,
  isPathAllowedForTier,
} from '@/scripts/validators/tests/validate-test-naming.js';

describe('validate-test-naming helpers', () => {
  it('detects tier suffixes including db.unit', () => {
    expect(detectTier('user.service.unit.test.ts')).toBe('unit');
    expect(detectTier('user.repository.db.unit.test.ts')).toBe('unit');
    expect(detectTier('auth.test.ts')).toBeUndefined();
  });

  it('exempts bundled domain e2e and legacy validator tests', () => {
    expect(isExemptFromTierSuffix('domains/auth/__tests__/auth.test.ts', 'auth.test.ts')).toBe(
      true,
    );
    expect(
      isExemptFromTierSuffix(
        'domains/auth/sub-domains/auth-mfa/__tests__/unit/auth-mfa.validator.test.ts',
        'auth-mfa.validator.test.ts',
      ),
    ).toBe(true);
    expect(
      isExemptFromTierSuffix(
        'domains/auth/sub-domains/auth-method/events/__tests__/handler.test.ts',
        'handler.test.ts',
      ),
    ).toBe(false);
  });

  it('allows unit tier under __tests__/unit and tests/unit', () => {
    expect(
      isPathAllowedForTier(
        'domains/user/sub-domains/user-settings/__tests__/unit/foo.unit.test.ts',
        'unit',
      ),
    ).toBe(true);
    expect(isPathAllowedForTier('tests/unit/utils/http/response.util.unit.test.ts', 'unit')).toBe(
      true,
    );
    expect(isPathAllowedForTier('domains/user/foo.unit.test.ts', 'unit')).toBe(false);
  });

  it('allows global tier only under tests/global', () => {
    expect(isPathAllowedForTier('tests/global/import-paths.global.test.ts', 'global')).toBe(true);
    expect(isPathAllowedForTier('tests/unit/import-paths.global.test.ts', 'global')).toBe(false);
  });
});
