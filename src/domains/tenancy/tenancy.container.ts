import type { FastifyInstance } from 'fastify';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { UserSettingsService } from '@/domains/user/sub-domains/user-settings/user-settings.service.js';
import { OrganizationRepository } from './sub-domains/organization/organization.repository.js';
import { OrganizationSettingsRepository } from './sub-domains/organization/organization-settings/organization-settings.repository.js';
import { OrganizationNotificationPolicyRepository } from './sub-domains/organization/organization-notification-policy/organization-notification-policy.repository.js';
import { OrganizationApiKeyRepository } from './sub-domains/organization/organization-api-key/organization-api-key.repository.js';
import { MembershipRepository } from './sub-domains/membership/membership.repository.js';
import { MemberInvitationRepository } from './sub-domains/membership/member-invitation/member-invitation.repository.js';
import { MemberRoleRepository } from './sub-domains/member-roles/member-role.repository.js';
import { MemberRolePermissionRepository } from './sub-domains/member-roles/member-role-permission/member-role-permission.repository.js';
import { PermissionRepository } from './sub-domains/permission/permission.repository.js';
import { OrganizationService } from './sub-domains/organization/organization.service.js';
import { OrganizationSettingsService } from './sub-domains/organization/organization-settings/organization-settings.service.js';
import { OrganizationNotificationPolicyService } from './sub-domains/organization/organization-notification-policy/organization-notification-policy.service.js';
import { OrganizationApiKeyService } from './sub-domains/organization/organization-api-key/organization-api-key.service.js';
import { MembershipService } from './sub-domains/membership/membership.service.js';
import { MemberInvitationService } from './sub-domains/membership/member-invitation/member-invitation.service.js';
import { MemberRoleService } from './sub-domains/member-roles/member-role.service.js';
import { MemberRolePermissionService } from './sub-domains/member-roles/member-role-permission/member-role-permission.service.js';
import { PermissionService } from './sub-domains/permission/permission.service.js';
import { AuthorizationService } from './sub-domains/permission/authorization.service.js';

export type TenancyContainer = {
  organizationService: OrganizationService;
  organizationSettingsService: OrganizationSettingsService;
  organizationNotificationPolicyService: OrganizationNotificationPolicyService;
  organizationApiKeyService: OrganizationApiKeyService;
  memberRoleService: MemberRoleService;
  memberRolePermissionService: MemberRolePermissionService;
  membershipService: MembershipService;
  memberInvitationService: MemberInvitationService;
  permissionService: PermissionService;
  authorizationService: AuthorizationService;
};

export function createTenancyContainer(
  userService: UserService,
  _objectStorage: ObjectStoragePort,
  userSettingsService?: UserSettingsService,
): TenancyContainer {
  const organizationRepository = new OrganizationRepository();
  const organizationSettingsRepository = new OrganizationSettingsRepository();
  const organizationNotificationPolicyRepository = new OrganizationNotificationPolicyRepository();
  const organizationApiKeyRepository = new OrganizationApiKeyRepository();
  const membershipRepository = new MembershipRepository();
  const memberInvitationRepository = new MemberInvitationRepository();
  const memberRoleRepository = new MemberRoleRepository();
  const memberRolePermissionRepository = new MemberRolePermissionRepository();
  const permissionRepository = new PermissionRepository();

  const organizationService = new OrganizationService(organizationRepository, _objectStorage);
  const organizationSettingsService = new OrganizationSettingsService(
    organizationRepository,
    organizationSettingsRepository,
  );
  const organizationNotificationPolicyService = new OrganizationNotificationPolicyService(
    organizationRepository,
    organizationNotificationPolicyRepository,
  );
  const organizationApiKeyService = new OrganizationApiKeyService(
    organizationRepository,
    organizationApiKeyRepository,
  );
  const memberRoleService = new MemberRoleService(organizationService, memberRoleRepository);
  const permissionService = new PermissionService(permissionRepository);
  const authorizationService = new AuthorizationService(permissionRepository);
  const memberRolePermissionService = new MemberRolePermissionService(
    organizationRepository,
    memberRoleRepository,
    memberRolePermissionRepository,
  );
  const membershipService = new MembershipService(
    organizationService,
    memberRoleService,
    memberRolePermissionService,
    membershipRepository,
    organizationSettingsService,
    userSettingsService,
  );
  const memberInvitationService = new MemberInvitationService(
    organizationRepository,
    membershipRepository,
    memberInvitationRepository,
    userService,
  );

  return {
    organizationService,
    organizationSettingsService,
    organizationNotificationPolicyService,
    organizationApiKeyService,
    memberRoleService,
    memberRolePermissionService,
    membershipService,
    memberInvitationService,
    permissionService,
    authorizationService,
  };
}

export function registerTenancyContainer(application: FastifyInstance): void {
  const objectStorage = getDefaultS3ObjectStorageAdapter();
  application.decorate(
    'tenancyDomain',
    createTenancyContainer(
      application.userDomain.userService,
      objectStorage,
      application.userDomain.userSettingsService,
    ),
  );
}
