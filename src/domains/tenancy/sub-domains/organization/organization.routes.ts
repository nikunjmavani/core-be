import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { STRICT_AUTHED_RATE_LIMIT } from '@/shared/middlewares/rate-limit-presets.constants.js';
import type { OrganizationService } from './organization.service.js';
import type { OrganizationSettingsService } from './organization-settings/organization-settings.service.js';
import type { OrganizationNotificationPolicyService } from './organization-notification-policy/organization-notification-policy.service.js';
import type { AuditService } from '@/domains/audit/audit.service.js';
import { ListAuditLogsQueryDto } from '@/domains/audit/audit.dto.js';
import type { OrganizationApiKeyService } from './organization-api-key/organization-api-key.service.js';
import { createOrganizationController } from './organization.controller.js';
import { createOrganizationApiKeyController } from './organization-api-key/organization-api-key.controller.js';
import { createOrganizationSettingsController } from './organization-settings/organization-settings.controller.js';
import { createOrganizationNotificationPolicyController } from './organization-notification-policy/organization-notification-policy.controller.js';
import { requireOrganizationPermission } from '@/shared/utils/auth/authorization.util.js';
import { rejectLegacyPagePagination } from '@/shared/utils/http/pagination.util.js';
import { TENANCY_PERMISSIONS } from '../../tenancy.permissions.js';
import { AUDIT_PERMISSIONS } from '@/domains/audit/audit.permissions.js';
import {
  createOrganizationDto,
  listOrganizationsQueryDto,
  organizationIdParamsDto,
  organizationSlugParamsDto,
  updateOrganizationDto,
  uploadLogoDto,
} from './organization.dto.js';
import { updateOrganizationSettingsDto } from './organization-settings/organization-settings.dto.js';
import {
  createOrganizationApiKeyDto,
  listOrganizationApiKeysQueryDto,
  updateOrganizationApiKeyDto,
} from './organization-api-key/organization-api-key.dto.js';
import {
  createOrganizationNotificationPolicyDto,
  updateOrganizationNotificationPolicyDto,
} from './organization-notification-policy/organization-notification-policy.dto.js';

export interface OrganizationRoutesDeps {
  organizationService: OrganizationService;
  organizationSettingsService: OrganizationSettingsService;
  organizationNotificationPolicyService: OrganizationNotificationPolicyService;
  organizationApiKeyService: OrganizationApiKeyService;
  auditService?: AuditService;
}

export function organizationRoutes(deps: OrganizationRoutesDeps): FastifyPluginAsync {
  const organizationController = createOrganizationController(
    deps.organizationService,
    deps.auditService,
  );
  const settingsController = createOrganizationSettingsController(deps.organizationSettingsService);
  const notificationPolicyController = createOrganizationNotificationPolicyController(
    deps.organizationNotificationPolicyService,
  );
  const apiKeyController = createOrganizationApiKeyController(deps.organizationApiKeyService);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    // Organization CRUD
    zodApplication.get(
      '/organizations',
      {
        schema: { querystring: listOrganizationsQueryDto },
        onRequest: [app.authenticate],
        preValidation: [rejectLegacyPagePagination],
      },
      organizationController.listOrganizations,
    );
    zodApplication.get(
      '/organizations/:id',
      {
        schema: { params: organizationIdParamsDto },
        onRequest: [app.authenticate],
      },
      organizationController.getOrganization,
    );
    zodApplication.get(
      '/organizations/by-slug/:slug',
      {
        schema: { params: organizationSlugParamsDto },
        onRequest: [app.authenticate],
      },
      organizationController.getOrganizationBySlug,
    );
    zodApplication.post(
      '/organizations',
      {
        schema: { body: createOrganizationDto },
        onRequest: [app.authenticate],
      },
      organizationController.createOrganization,
    );
    zodApplication.patch(
      '/organizations/:id',
      {
        schema: { params: organizationIdParamsDto, body: updateOrganizationDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ORGANIZATION_UPDATE, 'id')],
      },
      organizationController.updateOrganization,
    );
    zodApplication.delete(
      '/organizations/:id',
      {
        schema: { params: organizationIdParamsDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ORGANIZATION_DELETE, 'id')],
      },
      organizationController.deleteOrganization,
    );

    // Organization Logo
    zodApplication.put(
      '/organizations/:id/logo',
      {
        schema: { params: organizationIdParamsDto, body: uploadLogoDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ORGANIZATION_UPDATE, 'id')],
      },
      organizationController.uploadLogo,
    );
    zodApplication.delete<{ Params: { id: string } }>(
      '/organizations/:id/logo',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ORGANIZATION_UPDATE, 'id')],
      },
      organizationController.deleteLogo,
    );

    // Organization Audit Logs
    zodApplication.get<{ Params: { id: string } }>(
      '/organizations/:id/audit-logs',
      {
        schema: {
          params: organizationIdParamsDto,
          querystring: ListAuditLogsQueryDto,
        },
        onRequest: [app.authenticate],
        preValidation: [rejectLegacyPagePagination],
        preHandler: [requireOrganizationPermission(AUDIT_PERMISSIONS.AUDIT_LOG_READ, 'id')],
      },
      organizationController.listOrganizationAuditLogs,
    );

    // Organization Settings
    zodApplication.get<{ Params: { id: string } }>(
      '/organizations/:id/settings',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ORGANIZATION_READ, 'id')],
      },
      settingsController.getSettings,
    );
    zodApplication.patch<{ Params: { id: string } }>(
      '/organizations/:id/settings',
      {
        schema: { body: updateOrganizationSettingsDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ORGANIZATION_UPDATE, 'id')],
      },
      settingsController.updateSettings,
    );

    // Organization API Keys
    zodApplication.get<{ Params: { id: string } }>(
      '/organizations/:id/api-keys',
      {
        schema: {
          params: organizationIdParamsDto,
          querystring: listOrganizationApiKeysQueryDto,
        },
        onRequest: [app.authenticate],
        preValidation: [rejectLegacyPagePagination],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.API_KEY_READ, 'id')],
      },
      apiKeyController.listApiKeys,
    );
    zodApplication.get<{ Params: { id: string; apiKeyId: string } }>(
      '/organizations/:id/api-keys/:apiKeyId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.API_KEY_READ, 'id')],
      },
      apiKeyController.getApiKey,
    );
    zodApplication.post<{ Params: { id: string } }>(
      '/organizations/:id/api-keys',
      {
        schema: { body: createOrganizationApiKeyDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.API_KEY_MANAGE, 'id')],
      },
      apiKeyController.createApiKey,
    );
    zodApplication.patch<{ Params: { id: string; apiKeyId: string } }>(
      '/organizations/:id/api-keys/:apiKeyId',
      {
        schema: { body: updateOrganizationApiKeyDto },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.API_KEY_MANAGE, 'id')],
      },
      apiKeyController.updateApiKey,
    );
    zodApplication.delete<{ Params: { id: string; apiKeyId: string } }>(
      '/organizations/:id/api-keys/:apiKeyId',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.API_KEY_MANAGE, 'id')],
      },
      apiKeyController.deleteApiKey,
    );
    zodApplication.post<{ Params: { id: string; apiKeyId: string } }>(
      '/organizations/:id/api-keys/:apiKeyId/rotate',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.API_KEY_MANAGE, 'id')],
        ...STRICT_AUTHED_RATE_LIMIT,
      },
      apiKeyController.rotateApiKey,
    );

    // Organization Notification Policies
    zodApplication.get<{ Params: { id: string } }>(
      '/organizations/:id/notification-policies',
      {
        onRequest: [app.authenticate],
        preHandler: [
          requireOrganizationPermission(TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ, 'id'),
        ],
      },
      notificationPolicyController.listPolicies,
    );
    zodApplication.get<{ Params: { id: string; policyId: string } }>(
      '/organizations/:id/notification-policies/:policyId',
      {
        onRequest: [app.authenticate],
        preHandler: [
          requireOrganizationPermission(TENANCY_PERMISSIONS.NOTIFICATION_POLICY_READ, 'id'),
        ],
      },
      notificationPolicyController.getPolicy,
    );
    zodApplication.post<{ Params: { id: string } }>(
      '/organizations/:id/notification-policies',
      {
        schema: { body: createOrganizationNotificationPolicyDto },
        onRequest: [app.authenticate],
        preHandler: [
          requireOrganizationPermission(TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE, 'id'),
        ],
      },
      notificationPolicyController.createPolicy,
    );
    zodApplication.patch<{ Params: { id: string; policyId: string } }>(
      '/organizations/:id/notification-policies/:policyId',
      {
        schema: { body: updateOrganizationNotificationPolicyDto },
        onRequest: [app.authenticate],
        preHandler: [
          requireOrganizationPermission(TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE, 'id'),
        ],
      },
      notificationPolicyController.updatePolicy,
    );
    zodApplication.delete<{ Params: { id: string; policyId: string } }>(
      '/organizations/:id/notification-policies/:policyId',
      {
        onRequest: [app.authenticate],
        preHandler: [
          requireOrganizationPermission(TENANCY_PERMISSIONS.NOTIFICATION_POLICY_MANAGE, 'id'),
        ],
      },
      notificationPolicyController.deletePolicy,
    );
  };
}
