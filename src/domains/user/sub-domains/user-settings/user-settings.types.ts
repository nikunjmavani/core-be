/** API response shape for `GET /api/v1/users/me/settings` and the body of the patch response. */
export interface UserSettingsOutput {
  is_dark_mode_enabled: boolean;
  is_notifications_enabled: boolean;
  language: string;
  preferred_locales: string[];
}
