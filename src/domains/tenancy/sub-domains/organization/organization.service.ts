import { ConflictError, NotFoundError, ValidationError } from '@/shared/errors/index.js';
import { GLOBAL_ROLES, type GlobalRole } from '@/shared/constants/roles.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import type { OrganizationRepository } from './organization.repository.js';
import type {
  OrganizationBillingContext,
  OrganizationMembershipContext,
  OrganizationOutput,
} from './organization.types.js';
import {
  validateCreateOrganization,
  validateUpdateOrganization,
  validateListOrganizationsQuery,
  validateUploadLogo,
} from './organization.validator.js';
import { serializeOrganization } from './organization.serializer.js';
import { buildOrganizationLogoKeyPrefix } from '@/domains/upload/upload.constants.js';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { UploadService } from '@/domains/upload/upload.service.js';

export type OrganizationOffboardingDependencies = {
  uploadService: UploadService;
};

export class OrganizationService {
  private offboardingDependencies: OrganizationOffboardingDependencies | null = null;
  /** Public reference for composition-root assertions; populated at boot via wireOffboardingUploadService. */
  public offboardingUploadService: UploadService | null = null;

  constructor(
    private readonly repository: OrganizationRepository,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  wireOffboardingUploadService(uploadService: UploadService): void {
    this.offboardingDependencies = { uploadService };
    this.offboardingUploadService = uploadService;
  }

  private extractOrganizationLogoStorageKey(
    public_id: string,
    logo_url: string | null,
  ): string | null {
    if (!logo_url) return null;
    const prefix = buildOrganizationLogoKeyPrefix(public_id);
    if (logo_url.startsWith(prefix)) return logo_url;
    const keyMatch = logo_url.match(/organization-logos\/[^?#]+/);
    return keyMatch?.[0] ?? null;
  }

  private async clearOrganizationLogoStorage(
    public_id: string,
    logo_url: string | null,
  ): Promise<void> {
    const storageKey = this.extractOrganizationLogoStorageKey(public_id, logo_url);
    if (!storageKey) return;
    const objectDeleted = await this.objectStorage.deleteObject(storageKey);
    if (!objectDeleted) {
      logger.warn(
        { publicId: public_id, logoKey: storageKey },
        'organization.offboarding.logoDeleteFailed',
      );
    }
    await this.repository.update(public_id, { logo_url: null }, null);
  }

  async requireOrganizationByPublicId(public_id: string): Promise<OrganizationBillingContext> {
    const organization = await this.requireOrganizationMembershipByPublicId(public_id);
    return {
      id: organization.id,
      public_id: organization.public_id,
      name: organization.name,
      slug: organization.slug,
      stripe_customer_id: organization.stripe_customer_id,
    };
  }

  async requireOrganizationMembershipByPublicId(
    public_id: string,
  ): Promise<OrganizationMembershipContext> {
    const organization = await this.repository.findByPublicId(public_id);
    if (!organization) throw new NotFoundError('Organization');
    return {
      id: organization.id,
      public_id: organization.public_id,
      name: organization.name,
      slug: organization.slug,
      stripe_customer_id: organization.stripe_customer_id,
      owner_user_id: organization.owner_user_id,
    };
  }

  async transferOrganizationOwnership(
    organization_public_id: string,
    new_owner_user_id: number,
  ): Promise<OrganizationMembershipContext> {
    await this.repository.updateOwner(organization_public_id, new_owner_user_id);
    return this.requireOrganizationMembershipByPublicId(organization_public_id);
  }

  async findOrganizationByInternalId(
    identifier: number,
  ): Promise<OrganizationBillingContext | null> {
    const organization = await this.repository.findById(identifier);
    if (!organization) return null;
    return {
      id: organization.id,
      public_id: organization.public_id,
      name: organization.name,
      slug: organization.slug,
      stripe_customer_id: organization.stripe_customer_id,
    };
  }

  async findOrganizationByPublicId(public_id: string): Promise<OrganizationBillingContext | null> {
    const organization = await this.repository.findByPublicId(public_id);
    if (!organization) return null;
    return {
      id: organization.id,
      public_id: organization.public_id,
      name: organization.name,
      slug: organization.slug,
      stripe_customer_id: organization.stripe_customer_id,
    };
  }

  async resolveUserInternalIdByPublicId(user_public_id: string): Promise<number | null> {
    return this.repository.resolveUserIdByPublicId(user_public_id);
  }

  async updateStripeCustomerIdForOrganization(
    organization_public_id: string,
    stripe_customer_id: string,
  ): Promise<void> {
    const organization = await this.repository.findByPublicId(organization_public_id);
    if (!organization) throw new NotFoundError('Organization');
    await this.repository.updateStripeCustomerId(organization.id, stripe_customer_id);
  }

  private isGlobalAdmin(global_role?: GlobalRole): boolean {
    return global_role === GLOBAL_ROLES.SUPER_ADMIN || global_role === GLOBAL_ROLES.ADMIN;
  }

  private async assertUserCanAccessOrganization(
    user_public_id: string,
    organization_public_id: string,
    global_role?: GlobalRole,
  ): Promise<void> {
    if (this.isGlobalAdmin(global_role)) {
      return;
    }
    const canAccess = await this.repository.userCanAccessOrganization(
      user_public_id,
      organization_public_id,
    );
    if (!canAccess) {
      throw new NotFoundError('Organization');
    }
  }

  /**
   * Cross-organization read for the current user. Wraps in `withUserDatabaseContext`
   * so the `organizations_user_discovery` and `memberships_user_self_discovery`
   * RLS policies see `app.current_user_id` (introduced by migration
   * `20260520000004_organization_discovery_and_invitation_lookup_rls.sql`). Without
   * this wrap the call returns empty when `DATABASE_RLS_SCOPED_CONTEXTS=true`.
   */
  async list(query: unknown, user_public_id: string, global_role?: GlobalRole) {
    const parsed = validateListOrganizationsQuery(query);
    const cursorPage = parsed.after !== undefined ? Number.parseInt(parsed.after, 10) : undefined;
    const page =
      Number.isFinite(cursorPage) && cursorPage !== undefined ? cursorPage : (parsed.page ?? 1);
    const { limit } = parsed;
    return withUserDatabaseContext(user_public_id, async () => {
      const result = this.isGlobalAdmin(global_role)
        ? await this.repository.findAll(page, limit)
        : await this.repository.findAllForUser(user_public_id, page, limit);
      return {
        ...result,
        items: result.items.map(serializeOrganization),
      };
    });
  }

  async getByPublicId(
    public_id: string,
    user_public_id: string,
    global_role?: GlobalRole,
  ): Promise<OrganizationOutput> {
    return withUserDatabaseContext(user_public_id, async () => {
      await this.assertUserCanAccessOrganization(user_public_id, public_id, global_role);
      const organization = await this.repository.findByPublicId(public_id);
      if (!organization) throw new NotFoundError('Organization');
      return serializeOrganization(organization);
    });
  }

  async getBySlug(
    slug: string,
    user_public_id: string,
    global_role?: GlobalRole,
  ): Promise<OrganizationOutput> {
    return withUserDatabaseContext(user_public_id, async () => {
      const organization = await this.repository.findBySlug(slug);
      if (!organization) throw new NotFoundError('Organization');
      await this.assertUserCanAccessOrganization(
        user_public_id,
        organization.public_id,
        global_role,
      );
      return serializeOrganization(organization);
    });
  }

  async create(body: unknown, owner_user_public_id: string): Promise<OrganizationOutput> {
    const parsed = validateCreateOrganization(body);
    /**
     * INSERT must pass `organizations_user_discovery` WITH CHECK
     * (`owner_user_id` resolves to the current `app.current_user_id`). The slug
     * existence check runs in the same wrap so the SELECT also sees the user GUC.
     */
    return withUserDatabaseContext(owner_user_public_id, async () => {
      const ownerId = await this.repository.resolveUserIdByPublicId(owner_user_public_id);
      if (ownerId === null) throw new NotFoundError('User');
      const existing = await this.repository.findBySlug(parsed.slug);
      if (existing)
        throw new ConflictError(
          'errors:organizationSlugExists',
          { slug: parsed.slug },
          `Organization with slug "${parsed.slug}" already exists`,
        );
      const created = await this.repository.create({
        name: parsed.name,
        slug: parsed.slug,
        owner_user_id: ownerId,
        created_by_user_id: ownerId,
      });
      return serializeOrganization(created);
    });
  }

  async update(
    public_id: string,
    body: unknown,
    updated_by_user_public_id: string,
  ): Promise<OrganizationOutput> {
    const parsed = validateUpdateOrganization(body);
    return withOrganizationDatabaseContext(public_id, async () => {
      const organization = await this.repository.findByPublicId(public_id);
      if (!organization) throw new NotFoundError('Organization');
      const userId = await this.repository.resolveUserIdByPublicId(updated_by_user_public_id);
      if (parsed.slug) {
        const existing = await this.repository.findBySlug(parsed.slug);
        if (existing && existing.public_id !== public_id) {
          throw new ConflictError(
            'errors:organizationSlugExists',
            { slug: parsed.slug },
            `Organization with slug "${parsed.slug}" already exists`,
          );
        }
      }
      const updated = await this.repository.update(
        public_id,
        omitUndefined(parsed),
        userId ?? null,
      );
      if (!updated) throw new NotFoundError('Organization');
      return serializeOrganization(updated);
    });
  }

  async delete(public_id: string): Promise<void> {
    const organization = await withOrganizationDatabaseContext(public_id, async () => {
      const found = await this.repository.findByPublicId(public_id);
      if (!found) throw new NotFoundError('Organization');
      return found;
    });
    // External I/O (S3) and the upload-service tombstone run outside the DB context.
    await this.clearOrganizationLogoStorage(public_id, organization.logo_url);
    if (this.offboardingDependencies) {
      await this.offboardingDependencies.uploadService.tombstoneAllByOrganizationId(
        organization.id,
      );
    }
    const deleted = await withOrganizationDatabaseContext(public_id, () =>
      this.repository.softDelete(public_id),
    );
    if (!deleted) throw new NotFoundError('Organization');
  }

  async uploadLogo(
    public_id: string,
    body: unknown,
    updated_by_user_public_id: string,
  ): Promise<OrganizationOutput> {
    const parsed = validateUploadLogo(body);
    const expectedPrefix = buildOrganizationLogoKeyPrefix(public_id);
    if (!parsed.key.startsWith(expectedPrefix)) {
      throw new ValidationError('errors:validation.logoKeyNotOwned', undefined, {
        key: ['Logo key does not belong to this organization'],
      });
    }
    if (!this.offboardingUploadService) {
      throw new Error('UploadService is not wired for logo-attach confirmation');
    }
    // External I/O (S3) runs outside the DB context.
    const metadata = await this.objectStorage.headObject(parsed.key);
    if (!metadata) {
      throw new ValidationError('errors:validation.logoNotFound', undefined, {
        key: ['Object does not exist'],
      });
    }
    if (metadata.contentType === 'image/svg+xml') {
      throw new ValidationError('errors:uploadContentTypeNotAllowed', undefined, {
        key: ['SVG logos are not allowed for security reasons'],
      });
    }
    const logoUrl = this.objectStorage.getObjectUrl(parsed.key);
    return withOrganizationDatabaseContext(public_id, async () => {
      const organization = await this.repository.findByPublicId(public_id);
      if (!organization) throw new NotFoundError('Organization');
      await this.offboardingUploadService!.assertKeyConfirmed(parsed.key);
      const userId = await this.repository.resolveUserIdByPublicId(updated_by_user_public_id);
      const updated = await this.repository.update(
        public_id,
        { logo_url: logoUrl },
        userId ?? null,
      );
      if (!updated) throw new NotFoundError('Organization');
      return serializeOrganization(updated);
    });
  }

  async deleteLogo(
    public_id: string,
    updated_by_user_public_id: string,
  ): Promise<OrganizationOutput> {
    const organization = await withOrganizationDatabaseContext(public_id, async () => {
      const found = await this.repository.findByPublicId(public_id);
      if (!found) throw new NotFoundError('Organization');
      return found;
    });
    // External I/O (S3) runs outside the DB context.
    if (organization.logo_url) {
      const keyMatch = organization.logo_url.match(/organization-logos\/[^?#]+/);
      if (keyMatch) {
        const metadata = await this.objectStorage.headObject(keyMatch[0]);
        if (!metadata) {
          throw new ValidationError('errors:validation.logoNotFound', undefined, {
            key: ['Object does not exist'],
          });
        }
      }
    }
    return withOrganizationDatabaseContext(public_id, async () => {
      const userId = await this.repository.resolveUserIdByPublicId(updated_by_user_public_id);
      const updated = await this.repository.update(public_id, { logo_url: null }, userId ?? null);
      if (!updated) throw new NotFoundError('Organization');
      return serializeOrganization(updated);
    });
  }
}
