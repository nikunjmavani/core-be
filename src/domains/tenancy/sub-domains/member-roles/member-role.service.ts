import { NotFoundError } from '@/shared/errors/index.js';
import { withOrganizationDatabaseContext } from '@/infrastructure/database/contexts/organization-database.context.js';
import type { OrganizationService } from '../organization/organization.service.js';
import type { MemberRoleRepository } from './member-role.repository.js';
import type { MemberRoleOutput, MemberRoleRow } from './member-role.types.js';
import {
  validateCreateMemberRole,
  validateUpdateMemberRole,
  validateListMemberRolesQuery,
} from './member-role.validator.js';
import { serializeMemberRole } from './member-role.serializer.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { CursorPaginationInput } from '@/shared/utils/http/pagination.util.js';

export class MemberRoleService {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly memberRoleRepository: MemberRoleRepository,
  ) {}

  async list(organization_public_id: string, pagination: CursorPaginationInput) {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      validateListMemberRolesQuery({
        limit: pagination.limit,
        after: pagination.after,
      });
      const result = await this.memberRoleRepository.findByOrganizationId(
        organization.id,
        omitUndefined({
          after: pagination.after,
          limit: pagination.limit,
        }),
      );
      return {
        items: result.items.map(serializeMemberRole),
        limit: result.limit,
        total: result.total,
        has_more: result.has_more,
        next_cursor: result.next_cursor,
      };
    });
  }

  async requireRoleRecordForOrganization(
    organization_id: number,
    role_public_id: string,
  ): Promise<MemberRoleRow> {
    const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization_id);
    if (!role) throw new NotFoundError('Role');
    return role;
  }

  async requireRoleRecordByPublicId(
    organization_public_id: string,
    role_public_id: string,
  ): Promise<MemberRoleRow> {
    const organization =
      await this.organizationService.requireOrganizationMembershipByPublicId(
        organization_public_id,
      );
    return this.requireRoleRecordForOrganization(organization.id, role_public_id);
  }

  async resolveRolePublicIdForOrganization(
    organization_id: number,
    role_internal_id: number,
  ): Promise<string> {
    const role = await this.memberRoleRepository.findByInternalId(
      role_internal_id,
      organization_id,
    );
    if (!role) throw new NotFoundError('Role');
    return role.public_id;
  }

  async resolveRolePublicIdByInternalId(
    organization_public_id: string,
    role_internal_id: number,
  ): Promise<string> {
    const organization =
      await this.organizationService.requireOrganizationMembershipByPublicId(
        organization_public_id,
      );
    return this.resolveRolePublicIdForOrganization(organization.id, role_internal_id);
  }

  async getByPublicId(
    organization_public_id: string,
    role_public_id: string,
  ): Promise<MemberRoleOutput> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
      if (!role) throw new NotFoundError('Role');
      return serializeMemberRole(role);
    });
  }

  async create(
    organization_public_id: string,
    body: unknown,
    created_by_user_public_id: string,
  ): Promise<MemberRoleOutput> {
    const parsed = validateCreateMemberRole(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(created_by_user_public_id);
      const created = await this.memberRoleRepository.create(
        omitUndefined({
          organization_id: organization.id,
          name: parsed.name,
          description: parsed.description,
          is_system: parsed.is_system,
          created_by_user_id: userId ?? null,
        }),
      );
      return serializeMemberRole(created);
    });
  }

  async update(
    organization_public_id: string,
    role_public_id: string,
    body: unknown,
    updated_by_user_public_id: string,
  ): Promise<MemberRoleOutput> {
    const parsed = validateUpdateMemberRole(body);
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const role = await this.memberRoleRepository.findByPublicId(role_public_id, organization.id);
      if (!role) throw new NotFoundError('Role');
      const userId =
        await this.organizationService.resolveUserInternalIdByPublicId(updated_by_user_public_id);
      const updated = await this.memberRoleRepository.update(
        role_public_id,
        organization.id,
        omitUndefined(parsed),
        userId ?? null,
      );
      if (!updated) throw new NotFoundError('Role');
      return serializeMemberRole(updated);
    });
  }

  async delete(organization_public_id: string, role_public_id: string): Promise<void> {
    return withOrganizationDatabaseContext(organization_public_id, async () => {
      const organization =
        await this.organizationService.requireOrganizationMembershipByPublicId(
          organization_public_id,
        );
      const deleted = await this.memberRoleRepository.softDelete(role_public_id, organization.id);
      if (!deleted) throw new NotFoundError('Role');
    });
  }
}
