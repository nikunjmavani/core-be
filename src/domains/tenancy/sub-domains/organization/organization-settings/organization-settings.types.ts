export type OrganizationDefaultLocale = 'en' | 'es';

export interface OrganizationSettingsOutput {
  organization_id: string;
  is_email_notifications_enabled: boolean;
  default_locale: OrganizationDefaultLocale;
  security_policy: object;
  created_at: string;
  updated_at: string;
}
