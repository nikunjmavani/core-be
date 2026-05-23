import { NotFoundError } from '@/shared/errors/index.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationRepository } from '../organization.repository.js';
import type { OrganizationNotificationPolicyRepository } from './organization-notification-policy.repository.js';
import type { OrganizationNotificationPolicyOutput } from './organization-notification-policy.types.js';
import {
  validateCreateOrganizationNotificationPolicy,
  validateUpdateOrganizationNotificationPolicy,
} from './organization-notification-policy.validator.js';
import { serializeOrganizationNotificationPolicy } from './organization-notification-policy.serializer.js';

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
