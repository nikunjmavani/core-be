import { NotFoundError } from '@/shared/errors/index.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { OrganizationNotificationPolicyRepository } from './organization-notification-policy.repository.js';
import type { OrganizationNotificationPolicyOutput } from './organization-notification-policy.types.js';
import {
  validateCreateOrganizationNotificationPolicy,
  validateUpdateOrganizationNotificationPolicy,
} from './organization-notification-policy.validator.js';
import { serializeOrganizationNotificationPolicy } from './organization-notification-policy.serializer.js';

/**
 * Tenancy service for organization-scoped notification-delivery policies
 * (CRUD over `(notification_type, channel)` pairs).
 *
 * @remarks
 * - **Algorithm:** every operation is wrapped in
 *   `withOrganizationDatabaseContext` so RLS (`app.current_organization_id`)
 *   matches the resource. Create defers to the repository's upsert which
 *   resurrects soft-deleted rows on `(organization_id, notification_type,
 *   channel)` conflicts. Update copies only defined fields and converts
 *   `muted_until` ISO strings to `Date`.
 * - **Failure modes:** `NotFoundError('Organization')` when the parent
 *   tenant is missing or invisible under RLS;
 *   `NotFoundError('Organization notification policy')` for unknown ids;
 *   `ValidationError` from the DTO validators.
 * - **Side effects:** persistent writes to
 *   `tenancy.organization_notification_policies`; no event emission and no
 *   external I/O.
 * - **Notes:** soft-delete only — tombstone hard-delete is performed by the
 *   organization-notification-policy retention worker.
 */
export class OrganizationNotificationPolicyService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly policyRepository: OrganizationNotificationPolicyRepository,
  ) {}

  async list(organization_public_id: string): Promise<OrganizationNotificationPolicyOutput[]> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const rows = await this.policyRepository.findByOrganizationId(organization.id);
      return rows.map((row) =>
        serializeOrganizationNotificationPolicy(row, organization_public_id),
      );
    });
  }

  async getById(
    organization_public_id: string,
    policy_id: number,
  ): Promise<OrganizationNotificationPolicyOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const row = await this.policyRepository.findById(policy_id, organization.id);
      if (!row) throw new NotFoundError('Organization notification policy');
      return serializeOrganizationNotificationPolicy(row, organization_public_id);
    });
  }

  async create(
    organization_public_id: string,
    body: unknown,
    created_by_user_public_id: string,
  ): Promise<OrganizationNotificationPolicyOutput> {
    const parsed = validateCreateOrganizationNotificationPolicy(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const userId =
        await this.organizationRepository.resolveUserIdByPublicId(created_by_user_public_id);
      const mutedUntil = parsed.muted_until ? new Date(parsed.muted_until) : null;
      const row = await this.policyRepository.create({
        organization_id: organization.id,
        notification_type: parsed.notification_type,
        channel: parsed.channel,
        default_enabled: parsed.default_enabled,
        is_mandatory: parsed.is_mandatory,
        muted_until: mutedUntil,
        created_by_user_id: userId,
      });
      return serializeOrganizationNotificationPolicy(row, organization_public_id);
    });
  }

  async update(
    organization_public_id: string,
    policy_id: number,
    body: unknown,
    updated_by_user_public_id: string,
  ): Promise<OrganizationNotificationPolicyOutput> {
    const parsed = validateUpdateOrganizationNotificationPolicy(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const userId =
        await this.organizationRepository.resolveUserIdByPublicId(updated_by_user_public_id);
      const data: {
        default_enabled?: boolean;
        is_mandatory?: boolean;
        muted_until?: Date | null;
      } = {};
      if (parsed.default_enabled !== undefined) data.default_enabled = parsed.default_enabled;
      if (parsed.is_mandatory !== undefined) data.is_mandatory = parsed.is_mandatory;
      if (parsed.muted_until !== undefined) {
        data.muted_until = parsed.muted_until ? new Date(parsed.muted_until) : null;
      }
      const row = await this.policyRepository.update(
        policy_id,
        organization.id,
        data,
        userId ?? null,
      );
      if (!row) throw new NotFoundError('Organization notification policy');
      return serializeOrganizationNotificationPolicy(row, organization_public_id);
    });
  }

  async delete(organization_public_id: string, policy_id: number): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization = await this.organizationRepository.findByPublicId(organization_public_id);
      if (!organization) throw new NotFoundError('Organization');
      const deleted = await this.policyRepository.softDelete(policy_id, organization.id);
      if (!deleted) throw new NotFoundError('Organization notification policy');
    });
  }
}
