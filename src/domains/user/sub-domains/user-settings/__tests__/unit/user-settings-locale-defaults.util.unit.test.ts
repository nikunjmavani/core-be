import { describe, expect, it } from 'vitest';
import {
  isFactoryDefaultUserLocaleSettings,
  preferredLocalesForOrganizationDefaultLocale,
} from '@/domains/user/sub-domains/user-settings/user-settings-locale-defaults.util.js';

describe('user-settings-locale-defaults.util', () => {
  it('isFactoryDefaultUserLocaleSettings treats missing row as factory default', () => {
    expect(isFactoryDefaultUserLocaleSettings(null)).toBe(true);
    expect(isFactoryDefaultUserLocaleSettings(undefined)).toBe(true);
  });

  it('isFactoryDefaultUserLocaleSettings recognizes factory English row', () => {
    expect(isFactoryDefaultUserLocaleSettings({ language: 'en', preferred_locales: ['en'] })).toBe(
      true,
    );
  });

  it('isFactoryDefaultUserLocaleSettings rejects customized locales', () => {
    expect(
      isFactoryDefaultUserLocaleSettings({ language: 'es', preferred_locales: ['es', 'en'] }),
    ).toBe(false);
  });

  it('preferredLocalesForOrganizationDefaultLocale returns a single-tag array', () => {
    expect(preferredLocalesForOrganizationDefaultLocale('es')).toEqual(['es']);
  });
});
