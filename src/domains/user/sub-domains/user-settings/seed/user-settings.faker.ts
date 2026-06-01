/**
 * Faker generators for the user-settings bulk seeder. Callers pass the orchestrator's seeded
 * `faker` so output is reproducible for a given `SEED`.
 */
import type { Faker } from '@faker-js/faker';

/** Generated personalization toggles + locale preferences for one `auth.user_settings` row. */
export interface BulkUserSettingsProfile {
  /** Whether dark mode is enabled. */
  is_dark_mode_enabled: boolean;
  /** Whether in-app notifications are enabled. */
  is_notifications_enabled: boolean;
  /** Primary UI language code. */
  language: string;
  /** Ordered list of preferred locales (always starts with `language`). */
  preferred_locales: string[];
}

const SUPPORTED_LANGUAGES = ['en', 'es'] as const;

/** Builds one fake user-settings profile from the provided faker instance. */
export function generateBulkUserSettings(faker: Faker): BulkUserSettingsProfile {
  const language = faker.helpers.arrayElement(SUPPORTED_LANGUAGES);
  return {
    is_dark_mode_enabled: faker.datatype.boolean(),
    is_notifications_enabled: faker.datatype.boolean({ probability: 0.8 }),
    language,
    preferred_locales: language === 'en' ? ['en'] : [language, 'en'],
  };
}
