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

/**
 * Service collaborators required by the organization routes plugin. Includes
 * the four organization-scoped services plus the optional audit service used
 * by the `/organizations/:id/audit-logs` endpoint.
 */
export interface OrganizationRoutesDeps {
  organizationService: OrganizationService;
  organizationSettingsService: OrganizationSettingsService;
  organizationNotificationPolicyService: OrganizationNotificationPolicyService;
  organizationApiKeyService: OrganizationApiKeyService;
  auditService?: AuditService;
}

/**
 * Returns the Fastify plugin that mounts every organization endpoint —
 * organization CRUD, logo upload/delete, audit-log listing, settings,
 * API keys (CRUD + rotate), and notification policies. Each route is wired
 * with auth, the right `requireOrganizationPermission` preHandler, and Zod
 * schemas (which the OpenAPI generator consumes for tags and summaries).
 */
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
        schema: {
          summary: 'List my organizations',
          description: 'Returns all organizations the authenticated user is a member of.',
          tags: ['Organization'],
          querystring: listOrganizationsQueryDto,
        },
        onRequest: [app.authenticate],
        preValidation: [rejectLegacyPagePagination],
      },
      organizationController.listOrganizations,
    );
    zodApplication.get(
      '/organizations/:id',
      {
        schema: {
          summary: 'Get organization by ID',
          description: 'Returns organization details including name, slug, status, and logo.',
          tags: ['Organization'],
          params: organizationIdParamsDto,
        },
        onRequest: [app.authenticate],
      },
      organizationController.getOrganization,
    );
    zodApplication.get(
      '/organizations/by-slug/:slug',
      {
        schema: {
          summary: 'Get organization by slug',
          description: 'Looks up an organization by its unique URL-friendly slug.',
          tags: ['Organization'],
          params: organizationSlugParamsDto,
        },
        onRequest: [app.authenticate],
      },
      organizationController.getOrganizationBySlug,
    );
    zodApplication.post(
      '/organizations',
      {
        schema: {
          summary: 'Create organization',
          description:
            'Creates a new organization. The authenticated user becomes the owner automatically.',
          tags: ['Organization'],
          body: createOrganizationDto,
        },
        onRequest: [app.authenticate],
      },
      organizationController.createOrganization,
    );
    zodApplication.patch(
      '/organizations/:id',
      {
        schema: {
          summary: 'Update organization',
          description:
            'Updates organization details (name, slug, status, logo). Requires ORGANIZATION_UPDATE permission.',
          tags: ['Organization'],
          params: organizationIdParamsDto,
          body: updateOrganizationDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ORGANIZATION_UPDATE, 'id')],
      },
      organizationController.updateOrganization,
    );
    zodApplication.delete(
      '/organizations/:id',
      {
        schema: {
          summary: 'Delete organization',
          description:
            'Permanently deletes an organization and all its data. Requires ORGANIZATION_DELETE permission. This action is irreversible.',
          tags: ['Organization'],
          params: organizationIdParamsDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.ORGANIZATION_DELETE, 'id')],
      },
      organizationController.deleteOrganization,
    );

    // Organization Logo
    zodApplication.put(
      '/organizations/:id/logo',
      {
        schema: {
          summary: 'Upload organization logo',
          description:
            'Uploads or replaces the organization logo. Requires ORGANIZATION_UPDATE permission.',
          tags: ['Organization'],
          params: organizationIdParamsDto,
          body: uploadLogoDto,
        },
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
        schema: {
          summary: 'Remove organization logo',
          description: 'Removes the organization logo. Requires ORGANIZATION_UPDATE permission.',
          tags: ['Organization'],
        },
      },
      organizationController.deleteLogo,
    );

    // Organization Audit Logs
    zodApplication.get<{ Params: { id: string } }>(
      '/organizations/:id/audit-logs',
      {
        schema: {
          summary: 'List organization audit logs',
          description:
            'Returns a paginated list of audit log entries for the organization. Requires AUDIT_LOG_READ permission.',
          tags: ['Organization', 'Audit Log'],
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
        schema: {
          summary: 'Get organization settings',
          description:
            'Returns the organization settings (email notifications, security policy). Requires ORGANIZATION_READ permission.',
          tags: ['Organization', 'Organization Settings'],
        },
      },
      settingsController.getSettings,
    );
    zodApplication.patch<{ Params: { id: string } }>(
      '/organizations/:id/settings',
      {
        schema: {
          summary: 'Update organization settings',
          description: 'Updates organization settings. Requires ORGANIZATION_UPDATE permission.',
          tags: ['Organization', 'Organization Settings'],
          body: updateOrganizationSettingsDto,
        },
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
          summary: 'List API keys',
          description:
            'Returns all API keys for the organization. The key value is masked after creation. Requires API_KEY_READ permission.',
          tags: ['Organization', 'API Key'],
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
        schema: {
          summary: 'Get API key',
          description: 'Returns a single API key by ID. Requires API_KEY_READ permission.',
          tags: ['Organization', 'API Key'],
        },
      },
      apiKeyController.getApiKey,
    );
    zodApplication.post<{ Params: { id: string } }>(
      '/organizations/:id/api-keys',
      {
        schema: {
          summary: 'Create API key',
          description:
            'Creates a new API key. The full key value is only returned once in the creation response. Requires API_KEY_MANAGE permission.',
          tags: ['Organization', 'API Key'],
          body: createOrganizationApiKeyDto,
        },
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.API_KEY_MANAGE, 'id')],
      },
      apiKeyController.createApiKey,
    );
    zodApplication.patch<{ Params: { id: string; apiKeyId: string } }>(
      '/organizations/:id/api-keys/:apiKeyId',
      {
        schema: {
          summary: 'Update API key',
          description: 'Updates an API key (name or status). Requires API_KEY_MANAGE permission.',
          tags: ['Organization', 'API Key'],
          body: updateOrganizationApiKeyDto,
        },
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
        schema: {
          summary: 'Delete API key',
          description: 'Permanently deletes an API key. Requires API_KEY_MANAGE permission.',
          tags: ['Organization', 'API Key'],
        },
      },
      apiKeyController.deleteApiKey,
    );
    zodApplication.post<{ Params: { id: string; apiKeyId: string } }>(
      '/organizations/:id/api-keys/:apiKeyId/rotate',
      {
        onRequest: [app.authenticate],
        preHandler: [requireOrganizationPermission(TENANCY_PERMISSIONS.API_KEY_MANAGE, 'id')],
        ...STRICT_AUTHED_RATE_LIMIT,
        schema: {
          summary: 'Rotate API key',
          description:
            'Regenerates the API key secret. The old key is immediately invalidated. Requires API_KEY_MANAGE permission.',
          tags: ['Organization', 'API Key'],
        },
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
        schema: {
          summary: 'List notification policies',
          description:
            'Returns all notification policies for the organization. Requires NOTIFICATION_POLICY_READ permission.',
          tags: ['Organization', 'Notification Policy'],
        },
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
        schema: {
          summary: 'Get notification policy',
          description:
            'Returns a single notification policy. Requires NOTIFICATION_POLICY_READ permission.',
          tags: ['Organization', 'Notification Policy'],
        },
      },
      notificationPolicyController.getPolicy,
    );
    zodApplication.post<{ Params: { id: string } }>(
      '/organizations/:id/notification-policies',
      {
        schema: {
          summary: 'Create notification policy',
          description:
            'Creates a new notification policy defining how a notification type is delivered. Requires NOTIFICATION_POLICY_MANAGE permission.',
          tags: ['Organization', 'Notification Policy'],
          body: createOrganizationNotificationPolicyDto,
        },
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
        schema: {
          summary: 'Update notification policy',
          description:
            'Updates a notification policy. Requires NOTIFICATION_POLICY_MANAGE permission.',
          tags: ['Organization', 'Notification Policy'],
          body: updateOrganizationNotificationPolicyDto,
        },
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
        schema: {
          summary: 'Delete notification policy',
          description:
            'Deletes a notification policy. Requires NOTIFICATION_POLICY_MANAGE permission.',
          tags: ['Organization', 'Notification Policy'],
        },
      },
      notificationPolicyController.deletePolicy,
    );
  };
}
