import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateUpdateUserSettings } from '@/domains/user/sub-domains/user-settings/user-settings.validator.js';

describe('user-settings.validator', () => {
  it('validateUpdateUserSettings accepts boolean flags', () => {
    expect(validateUpdateUserSettings({ is_dark_mode_enabled: true })).toEqual({
      is_dark_mode_enabled: true,
    });
  });

  it('validateUpdateUserSettings rejects unknown fields', () => {
    expect(() => validateUpdateUserSettings({ unknownField: true })).toThrow(ValidationError);
  });
});
