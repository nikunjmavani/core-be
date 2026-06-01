/** BCP 47 locale tag exposed in serialized organization settings (mirrors the constrained DB column). */
export type OrganizationDefaultLocale = 'en' | 'es';

/** Public shape returned by `/organizations/:id/settings` — produced by {@link serializeOrganizationSettings}. */
export interface OrganizationSettingsOutput {
  organization_id: string;
  is_email_notifications_enabled: boolean;
  default_locale: OrganizationDefaultLocale;
  security_policy: object;
  created_at: string;
  updated_at: string;
}
