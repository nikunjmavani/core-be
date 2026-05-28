import { NotFoundError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '../organization.repository.js';
import type { OrganizationSettingsRepository } from './organization-settings.repository.js';
import type {
  OrganizationDefaultLocale,
  OrganizationSettingsOutput,
} from './organization-settings.types.js';
import { validateUpdateOrganizationSettings } from './organization-settings.validator.js';
import { serializeOrganizationSettings } from './organization-settings.serializer.js';

/**
 * Read/write service for the per-organization settings row plus two
 * unscoped helpers used during authentication.
 *
 * @remarks
 * - **Algorithm:** `get` and `update` run inside
 *   `withOrganizationDatabaseContext` (RLS) and lazily upsert the row when
 *   missing; `update` strips undefined fields with `omitUndefined` so PATCH
 *   semantics preserve unchanged columns.
 *   `resolveDefaultLocaleForOrganization` falls back to `'en'` when nothing
 *   is configured. `userHasOrganizationRequiringMfa` is delegated to the
 *   repository's unscoped query (no tenant context yet at login time).
 * - **Failure modes:** `NotFoundError('Organization')` when the parent
 *   organization is missing or invisible under RLS; validation errors
 *   propagate from {@link validateUpdateOrganizationSettings}.
 * - **Side effects:** `upsert` writes to `tenancy.organization_settings`;
 *   no events are emitted and no external I/O is performed.
 * - **Notes:** the locale and MFA helpers intentionally bypass tenant RLS
 *   because they run during login flow before the tenant cookie/header is
 *   resolved.
 */
export class OrganizationSettingsService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly settingsRepository: OrganizationSettingsRepository,
  ) {}

  async get(organization_public_id: string): Promise<OrganizationSettingsOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const settings = await this.settingsRepository.findByOrganizationId(organization.id);
      if (!settings) {
        const created = await this.settingsRepository.upsert(organization.id, {});
        return serializeOrganizationSettings(organization.public_id, created);
      }
      return serializeOrganizationSettings(organization.public_id, settings);
    });
  }

  async update(
    organization_public_id: string,
    body: unknown,
    _updated_by_user_public_id: string,
  ): Promise<OrganizationSettingsOutput> {
    const parsed = validateUpdateOrganizationSettings(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const updated = await this.settingsRepository.upsert(
        organization.id,
        omitUndefined({
          is_email_notifications_enabled: parsed.is_email_notifications_enabled,
          default_locale: parsed.default_locale,
          security_policy: parsed.security_policy as object | undefined,
        }),
      );
      return serializeOrganizationSettings(organization.public_id, updated);
    });
  }

  async resolveDefaultLocaleForOrganization(
    organizationPublicId: string,
  ): Promise<OrganizationDefaultLocale> {
    return withOrganizationDatabaseContext(organizationPublicId, async () => {
      const locale =
        await this.settingsRepository.findDefaultLocaleByOrganizationPublicId(organizationPublicId);
      return locale ?? 'en';
    });
  }

  async userHasOrganizationRequiringMfa(userId: number): Promise<boolean> {
    return this.settingsRepository.userHasOrganizationRequiringMfa(userId);
  }
}
