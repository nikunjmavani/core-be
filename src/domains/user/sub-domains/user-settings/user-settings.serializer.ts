import type { UserSettingsOutput } from './user-settings.types.js';

export interface UserSettingsRow {
  is_dark_mode_enabled: boolean;
  is_notifications_enabled: boolean;
  language: string;
  preferred_locales: unknown;
}

const DEFAULT_USER_SETTINGS: UserSettingsOutput = {
  is_dark_mode_enabled: false,
  is_notifications_enabled: true,
  language: 'en',
  preferred_locales: ['en'],
};

export function serializeUserSettings(row: UserSettingsRow | null): UserSettingsOutput {
  if (!row)
    return {
      ...DEFAULT_USER_SETTINGS,
      preferred_locales: [...DEFAULT_USER_SETTINGS.preferred_locales],
    };
  return {
    is_dark_mode_enabled: row.is_dark_mode_enabled,
    is_notifications_enabled: row.is_notifications_enabled,
    language: row.language,
    preferred_locales: (row.preferred_locales as string[]) ?? [
      ...DEFAULT_USER_SETTINGS.preferred_locales,
    ],
  };
}
