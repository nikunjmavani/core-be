/** OpenAPI success responses — tenancy. */
import type { ResponseDefinition } from '@tooling/openapi/response-map/building-blocks.js';
import { wrapPaginated, wrapSuccess } from '@tooling/openapi/response-map/building-blocks.js';
import * as schemas from '@tooling/openapi/response-map/resource-schemas.js';

export const tenancyRouteResponses: Record<string, ResponseDefinition> = {
  // ── Organization ──
  'GET /api/v1/tenancy/organizations': {
    statusCode: 200,
    schema: wrapPaginated(schemas.organizationSchema, [schemas.organizationExample]),
    example: null,
  },
  'GET /api/v1/tenancy/organizations/{id}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.organizationSchema, schemas.organizationExample),
    example: null,
  },
  'GET /api/v1/tenancy/organizations/by-slug/{slug}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.organizationSchema, schemas.organizationExample),
    example: null,
  },
  'POST /api/v1/tenancy/organizations': {
    statusCode: 201,
    schema: wrapSuccess(schemas.organizationSchema, schemas.organizationExample),
    example: null,
  },
  'PATCH /api/v1/tenancy/organizations/{id}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.organizationSchema, schemas.organizationExample),
    example: null,
  },
  'DELETE /api/v1/tenancy/organizations/{id}': { statusCode: 204, schema: null, example: null },
  'PUT /api/v1/tenancy/organizations/{id}/logo': {
    statusCode: 200,
    schema: wrapSuccess(schemas.organizationSchema, schemas.organizationExample),
    example: null,
  },
  'DELETE /api/v1/tenancy/organizations/{id}/logo': {
    statusCode: 200,
    schema: wrapSuccess(schemas.organizationSchema, {
      ...schemas.organizationExample,
      logo_url: null,
    }),
    example: null,
  },

  // ── Organization: Settings ──
  'GET /api/v1/tenancy/organizations/{id}/settings': {
    statusCode: 200,
    schema: wrapSuccess(schemas.organizationSettingsSchema, schemas.organizationSettingsExample),
    example: null,
  },
  'PATCH /api/v1/tenancy/organizations/{id}/settings': {
    statusCode: 200,
    schema: wrapSuccess(schemas.organizationSettingsSchema, schemas.organizationSettingsExample),
    example: null,
  },

  // ── Organization: API Keys ──
  'GET /api/v1/tenancy/organizations/{id}/api-keys': {
    statusCode: 200,
    schema: wrapPaginated(schemas.apiKeySchema, [schemas.apiKeyExample]),
    example: null,
  },
  'GET /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.apiKeySchema, schemas.apiKeyExample),
    example: null,
  },
  'POST /api/v1/tenancy/organizations/{id}/api-keys': {
    statusCode: 201,
    schema: wrapSuccess(
      {
        ...schemas.apiKeySchema,
        properties: { ...schemas.apiKeySchema.properties, key: { type: 'string' } },
      },
      schemas.apiKeyCreatedExample,
    ),
    example: null,
  },
  'PATCH /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.apiKeySchema, schemas.apiKeyExample),
    example: null,
  },
  'DELETE /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}': {
    statusCode: 204,
    schema: null,
    example: null,
  },
  'POST /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}/rotate': {
    statusCode: 201,
    schema: wrapSuccess(
      {
        ...schemas.apiKeySchema,
        properties: { ...schemas.apiKeySchema.properties, key: { type: 'string' } },
      },
      schemas.apiKeyCreatedExample,
    ),
    example: null,
  },

  // ── Organization: Notification Policies ──
  'GET /api/v1/tenancy/organizations/{id}/notification-policies': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.notificationPolicySchema }, [
      schemas.notificationPolicyExample,
    ]),
    example: null,
  },
  'GET /api/v1/tenancy/organizations/{id}/notification-policies/{policyId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.notificationPolicySchema, schemas.notificationPolicyExample),
    example: null,
  },
  'POST /api/v1/tenancy/organizations/{id}/notification-policies': {
    statusCode: 201,
    schema: wrapSuccess(schemas.notificationPolicySchema, schemas.notificationPolicyExample),
    example: null,
  },
  'PATCH /api/v1/tenancy/organizations/{id}/notification-policies/{policyId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.notificationPolicySchema, schemas.notificationPolicyExample),
    example: null,
  },
  'DELETE /api/v1/tenancy/organizations/{id}/notification-policies/{policyId}': {
    statusCode: 204,
    schema: null,
    example: null,
  },

  // ── Organization: Audit Logs ──
  'GET /api/v1/tenancy/organizations/{id}/audit-logs': {
    statusCode: 200,
    schema: wrapPaginated(schemas.auditLogSchema, [schemas.auditLogExample]),
    example: null,
  },

  // ── Membership ──
  'GET /api/v1/tenancy/organizations/{id}/memberships': {
    statusCode: 200,
    schema: wrapPaginated(schemas.membershipSchema, [schemas.membershipExample]),
    example: null,
  },
  'GET /api/v1/tenancy/organizations/{id}/memberships/{membershipId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.membershipSchema, schemas.membershipExample),
    example: null,
  },
  'GET /api/v1/tenancy/organizations/{id}/memberships/{membershipId}/permissions': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.permissionSchema }, [
      schemas.permissionExample,
    ]),
    example: null,
  },
  'POST /api/v1/tenancy/organizations/{id}/memberships': {
    statusCode: 201,
    schema: wrapSuccess(schemas.membershipSchema, schemas.membershipExample),
    example: null,
  },
  'PATCH /api/v1/tenancy/organizations/{id}/memberships/{membershipId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.membershipSchema, schemas.membershipExample),
    example: null,
  },
  'DELETE /api/v1/tenancy/organizations/{id}/memberships/{membershipId}': {
    statusCode: 204,
    schema: null,
    example: null,
  },
  'POST /api/v1/tenancy/organizations/{id}/leave': { statusCode: 204, schema: null, example: null },
  'POST /api/v1/tenancy/organizations/{id}/transfer-ownership': {
    statusCode: 200,
    schema: wrapSuccess(schemas.membershipSchema, schemas.membershipExample),
    example: null,
  },

  // ── Invitations ──
  'GET /api/v1/tenancy/organizations/{id}/invitations': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.invitationSchema }, [
      schemas.invitationExample,
    ]),
    example: null,
  },
  'POST /api/v1/tenancy/organizations/{id}/invitations': {
    statusCode: 201,
    schema: wrapSuccess(schemas.invitationSchema, schemas.invitationExample),
    example: null,
  },
  'POST /api/v1/tenancy/invitations/{invitationId}/accept': {
    statusCode: 200,
    schema: wrapSuccess(schemas.membershipSchema, schemas.membershipExample),
    example: null,
  },
  'DELETE /api/v1/tenancy/organizations/{id}/invitations/{invitationId}': {
    statusCode: 204,
    schema: null,
    example: null,
  },
  'POST /api/v1/tenancy/organizations/{id}/invitations/{invitationId}/resend': {
    statusCode: 200,
    schema: wrapSuccess(schemas.invitationSchema, {
      ...schemas.invitationExample,
      expires_at: '2026-02-28T10:30:00.000Z',
    }),
    example: null,
  },
  'GET /api/v1/tenancy/invitations/pending': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.invitationSchema }, [
      schemas.invitationExample,
    ]),
    example: null,
  },
  'POST /api/v1/tenancy/invitations/{invitationId}/decline': {
    statusCode: 204,
    schema: null,
    example: null,
  },

  // ── Roles ──
  'GET /api/v1/tenancy/organizations/{id}/roles': {
    statusCode: 200,
    schema: wrapPaginated(schemas.memberRoleSchema, [schemas.memberRoleExample]),
    example: null,
  },
  'GET /api/v1/tenancy/organizations/{id}/roles/{roleId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.memberRoleSchema, schemas.memberRoleExample),
    example: null,
  },
  'POST /api/v1/tenancy/organizations/{id}/roles': {
    statusCode: 201,
    schema: wrapSuccess(schemas.memberRoleSchema, {
      ...schemas.memberRoleExample,
      name: 'Editor',
      description: 'Can edit content',
      is_system: false,
    }),
    example: null,
  },
  'PATCH /api/v1/tenancy/organizations/{id}/roles/{roleId}': {
    statusCode: 200,
    schema: wrapSuccess(schemas.memberRoleSchema, schemas.memberRoleExample),
    example: null,
  },
  'DELETE /api/v1/tenancy/organizations/{id}/roles/{roleId}': {
    statusCode: 204,
    schema: null,
    example: null,
  },

  // ── Role Permissions ──
  'GET /api/v1/tenancy/organizations/{id}/roles/{roleId}/permissions': {
    statusCode: 200,
    schema: wrapSuccess(
      { type: 'array', items: schemas.memberRolePermissionSchema },
      schemas.memberRolePermissionExamples,
    ),
    example: null,
  },
  'PUT /api/v1/tenancy/organizations/{id}/roles/{roleId}/permissions': {
    statusCode: 200,
    schema: wrapSuccess(
      { type: 'array', items: schemas.memberRolePermissionSchema },
      schemas.memberRolePermissionExamples,
    ),
    example: null,
  },

  // ── Permissions ──
  'GET /api/v1/tenancy/permissions': {
    statusCode: 200,
    schema: wrapSuccess({ type: 'array', items: schemas.permissionSchema }, [
      schemas.permissionExample,
      {
        code: 'MEMBERSHIP_READ',
        name: 'Read Memberships',
        description: 'View organization members',
        category: 'membership',
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        code: 'ROLE_READ',
        name: 'Read Roles',
        description: 'View organization roles',
        category: 'role',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]),
    example: null,
  },

  // ── Plans ──
};
