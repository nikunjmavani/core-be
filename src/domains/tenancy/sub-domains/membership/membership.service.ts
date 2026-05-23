import { ForbiddenError, NotFoundError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { UserSettingsService } from '@/domains/user/sub-domains/user-settings/user-settings.service.js';
import {
  isFactoryDefaultUserLocaleSettings,
  preferredLocalesForOrganizationDefaultLocale,
} from '@/domains/user/sub-domains/user-settings/user-settings-locale-defaults.util.js';
import type { OrganizationService } from '../organization/organization.service.js';
import type { OrganizationSettingsService } from '../organization/organization-settings/organization-settings.service.js';
import type { MemberRoleService } from '../member-roles/member-role.service.js';
import type { MemberRolePermissionService } from '../member-roles/member-role-permission/member-role-permission.service.js';
import type { MembershipRepository } from './membership.repository.js';
import type { MembershipOutput } from './membership.types.js';
import {
  validateCreateMembership,
  validateUpdateMembership,
  validateListMembershipsQuery,
  validateTransferOwnership,
} from './membership.validator.js';
import { serializeMembership } from './membership.serializer.js';
import { invalidatePermissions } from '../permission/permission-cache.service.js';

export interface MembershipPermissionsOutput {
  permissions: string[];
}

export class MembershipService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly memberRoleService: MemberRoleService,
    private readonly memberRolePermissionService: MemberRolePermissionService,
    private readonly membershipRepository: MembershipRepository,
    private readonly organizationSettingsService?: OrganizationSettingsService,
    private readonly userSettingsService?: UserSettingsService,
  ) {}

  private async applyOrganizationLocaleDefaults(
    userPublicId: string,
    organizationPublicId: string,
  ): Promise<void> {
    if (!(this.organizationSettingsService && this.userSettingsService)) return;
    const currentSettings = await this.userSettingsService.get(userPublicId);
    if (!isFactoryDefaultUserLocaleSettings(currentSettings)) return;
    const defaultLocale =
      await this.organizationSettingsService.resolveDefaultLocaleForOrganization(
        organizationPublicId,
      );
    await this.userSettingsService.update(userPublicId, {
      language: defaultLocale,
      preferred_locales: preferredLocalesForOrganizationDefaultLocale(defaultLocale),
    });
  }

  async list(organization_public_id: string, query: unknown) {
    const parsed = validateListMembershipsQuery(query);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const page = parsed.page ?? 1;
      const result = await this.membershipRepository.findByOrganizationId(
        organization.id,
        page,
        parsed.limit,
      );
      return {
        ...result,
        items: result.items.map((membership) =>
          serializeMembership(membership, organization_public_id),
        ),
      };
    });
  }

  async getByPublicId(
    organization_public_id: string,
    membership_public_id: string,
  ): Promise<MembershipOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const membership = await this.membershipRepository.findByPublicId(
        membership_public_id,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      return serializeMembership(membership, organization_public_id);
    });
  }

  async create(
    organization_public_id: string,
    body: unknown,
    invited_by_user_public_id: string,
  ): Promise<MembershipOutput> {
    const parsed = validateCreateMembership(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const role = await this.memberRoleService.requireRoleRecordByPublicId(
        organization_public_id,
        parsed.role_id,
      );
      const userId = await this.organizationService.resolveUserInternalIdByPublicId(parsed.user_id);
      if (userId === null) throw new NotFoundError('User');
      const inviterId =
        await this.organizationService.resolveUserInternalIdByPublicId(invited_by_user_public_id);
      const created = await this.membershipRepository.create(
        omitUndefined({
          organization_id: organization.id,
          user_id: userId,
          role_id: role.id,
          status: parsed.status,
          invited_by_user_id: inviterId,
          created_by_user_id: inviterId,
        }),
      );
      await invalidatePermissions(parsed.user_id, organization_public_id);
      await this.applyOrganizationLocaleDefaults(parsed.user_id, organization_public_id);
      return serializeMembership(created, organization_public_id);
    });
  }

  async update(
    organization_public_id: string,
    membership_public_id: string,
    body: unknown,
    updated_by_user_public_id: string,
  ): Promise<MembershipOutput> {
    const parsed = validateUpdateMembership(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const membership = await this.membershipRepository.findByPublicId(
        membership_public_id,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(updated_by_user_public_id);
      const updated = await this.membershipRepository.update(
        membership_public_id,
        organization.id,
        omitUndefined(parsed),
        userId ?? null,
      );
      if (!updated) throw new NotFoundError('Membership');
      return serializeMembership(updated, organization_public_id);
    });
  }

  async delete(organization_public_id: string, membership_public_id: string): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const deleted = await this.membershipRepository.softDelete(
        membership_public_id,
        organization.id,
      );
      if (!deleted) throw new NotFoundError('Membership');
    });
  }

  async getPermissions(
    organization_public_id: string,
    membership_public_id: string,
  ): Promise<MembershipPermissionsOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const membership = await this.membershipRepository.findByPublicId(
        membership_public_id,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      const permissionCodes = await this.memberRolePermissionService.listPermissionCodesForRole(
        membership.role_id,
      );
      return { permissions: permissionCodes };
    });
  }

  async leaveOrganization(organization_public_id: string, user_public_id: string): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const userId = await this.organizationService.resolveUserInternalIdByPublicId(user_public_id);
      if (userId === null) throw new NotFoundError('User');
      const membership = await this.membershipRepository.findByUserAndOrganization(
        userId,
        organization.id,
      );
      if (!membership) throw new NotFoundError('Membership');
      if (organization.owner_user_id === userId) {
        throw new ForbiddenError('errors:ownerCannotLeave');
      }
      const deleted = await this.membershipRepository.softDelete(
        membership.public_id,
        organization.id,
      );
      if (!deleted) throw new NotFoundError('Membership');
    });
  }

  async transferOwnership(
    organization_public_id: string,
    body: unknown,
    current_user_public_id: string,
  ): Promise<MembershipOutput> {
    const parsed = validateTransferOwnership(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const currentUserId =
        await this.organizationService.resolveUserInternalIdByPublicId(current_user_public_id);
      if (currentUserId === null) throw new NotFoundError('User');
      if (organization.owner_user_id !== currentUserId) {
        throw new ForbiddenError('errors:onlyOwnerCanTransfer');
      }
      const newOwnerUserId = await this.organizationService.resolveUserInternalIdByPublicId(
        parsed.new_owner_user_id,
      );
      if (newOwnerUserId === null) throw new NotFoundError('User');
      const newOwnerMembership = await this.membershipRepository.findByUserAndOrganization(
        newOwnerUserId,
        organization.id,
      );
      if (!newOwnerMembership) throw new NotFoundError('New owner must be an active member');
      await this.organizationService.transferOrganizationOwnership(
        organization_public_id,
        newOwnerUserId,
      );
      return serializeMembership(newOwnerMembership, organization_public_id);
    });
  }
}
