import type { OrganizationSettingsOutput } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.types.js';

type OrganizationDefaultLocale = OrganizationSettingsOutput['default_locale'];

export const FACTORY_DEFAULT_USER_LANGUAGE = 'en';
export const FACTORY_DEFAULT_USER_PREFERRED_LOCALES = [FACTORY_DEFAULT_USER_LANGUAGE] as const;

type UserLocaleSettingsRow = {
  language: string;
  preferred_locales: unknown;
};

export function isFactoryDefaultUserLocaleSettings(
  settings: UserLocaleSettingsRow | null | undefined,
): boolean {
  if (!settings) {
    return true;
  }
  const preferredLocales = settings.preferred_locales as string[];
  return (
    settings.language === FACTORY_DEFAULT_USER_LANGUAGE &&
    preferredLocales.length === 1 &&
    preferredLocales[0] === FACTORY_DEFAULT_USER_LANGUAGE
  );
}

export function preferredLocalesForOrganizationDefaultLocale(
  organizationDefaultLocale: OrganizationDefaultLocale,
): string[] {
  return [organizationDefaultLocale];
}
