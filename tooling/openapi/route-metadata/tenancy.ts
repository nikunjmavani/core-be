/** OpenAPI route metadata — tenancy. */
import type { RouteMetadata } from './types.js';

export const tenancyMetadata: Record<string, RouteMetadata> = {
  // ── Organization ──
  'GET /api/v1/tenancy/organizations': {
    summary: 'List my organizations',
    description: 'Returns all organizations the authenticated user is a member of.',
    tags: ['Organization'],
  },
  'GET /api/v1/tenancy/organizations/{id}': {
    summary: 'Get organization by ID',
    description: 'Returns organization details including name, slug, status, and logo.',
    tags: ['Organization'],
  },
  'GET /api/v1/tenancy/organizations/by-slug/{slug}': {
    summary: 'Get organization by slug',
    description: 'Looks up an organization by its unique URL-friendly slug.',
    tags: ['Organization'],
  },
  'POST /api/v1/tenancy/organizations': {
    summary: 'Create organization',
    description:
      'Creates a new organization. The authenticated user becomes the owner automatically.',
    tags: ['Organization'],
  },
  'PATCH /api/v1/tenancy/organizations/{id}': {
    summary: 'Update organization',
    description:
      'Updates organization details (name, slug, status, logo). Requires ORGANIZATION_UPDATE permission.',
    tags: ['Organization'],
  },
  'DELETE /api/v1/tenancy/organizations/{id}': {
    summary: 'Delete organization',
    description:
      'Permanently deletes an organization and all its data. Requires ORGANIZATION_DELETE permission. This action is irreversible.',
    tags: ['Organization'],
  },
  'PUT /api/v1/tenancy/organizations/{id}/logo': {
    summary: 'Upload organization logo',
    description:
      'Uploads or replaces the organization logo. Requires ORGANIZATION_UPDATE permission.',
    tags: ['Organization'],
  },
  'DELETE /api/v1/tenancy/organizations/{id}/logo': {
    summary: 'Remove organization logo',
    description: 'Removes the organization logo. Requires ORGANIZATION_UPDATE permission.',
    tags: ['Organization'],
  },

  // ── Organization: Settings ──
  'GET /api/v1/tenancy/organizations/{id}/settings': {
    summary: 'Get organization settings',
    description:
      'Returns the organization settings (email notifications, security policy). Requires ORGANIZATION_READ permission.',
    tags: ['Organization', 'Organization Settings'],
  },
  'PATCH /api/v1/tenancy/organizations/{id}/settings': {
    summary: 'Update organization settings',
    description: 'Updates organization settings. Requires ORGANIZATION_UPDATE permission.',
    tags: ['Organization', 'Organization Settings'],
  },

  // ── Organization: API Keys ──
  'GET /api/v1/tenancy/organizations/{id}/api-keys': {
    summary: 'List API keys',
    description:
      'Returns all API keys for the organization. The key value is masked after creation. Requires API_KEY_READ permission.',
    tags: ['Organization', 'API Key'],
  },
  'GET /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}': {
    summary: 'Get API key',
    description: 'Returns a single API key by ID. Requires API_KEY_READ permission.',
    tags: ['Organization', 'API Key'],
  },
  'POST /api/v1/tenancy/organizations/{id}/api-keys': {
    summary: 'Create API key',
    description:
      'Creates a new API key. The full key value is only returned once in the creation response. Requires API_KEY_MANAGE permission.',
    tags: ['Organization', 'API Key'],
  },
  'PATCH /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}': {
    summary: 'Update API key',
    description: 'Updates an API key (name or status). Requires API_KEY_MANAGE permission.',
    tags: ['Organization', 'API Key'],
  },
  'DELETE /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}': {
    summary: 'Delete API key',
    description: 'Permanently deletes an API key. Requires API_KEY_MANAGE permission.',
    tags: ['Organization', 'API Key'],
  },
  'POST /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}/rotate': {
    summary: 'Rotate API key',
    description:
      'Regenerates the API key secret. The old key is immediately invalidated. Requires API_KEY_MANAGE permission.',
    tags: ['Organization', 'API Key'],
  },

  // ── Organization: Notification Policies ──
  'GET /api/v1/tenancy/organizations/{id}/notification-policies': {
    summary: 'List notification policies',
    description:
      'Returns all notification policies for the organization. Requires NOTIFICATION_POLICY_READ permission.',
    tags: ['Organization', 'Notification Policy'],
  },
  'GET /api/v1/tenancy/organizations/{id}/notification-policies/{policyId}': {
    summary: 'Get notification policy',
    description:
      'Returns a single notification policy. Requires NOTIFICATION_POLICY_READ permission.',
    tags: ['Organization', 'Notification Policy'],
  },
  'POST /api/v1/tenancy/organizations/{id}/notification-policies': {
    summary: 'Create notification policy',
    description:
      'Creates a new notification policy defining how a notification type is delivered. Requires NOTIFICATION_POLICY_MANAGE permission.',
    tags: ['Organization', 'Notification Policy'],
  },
  'PATCH /api/v1/tenancy/organizations/{id}/notification-policies/{policyId}': {
    summary: 'Update notification policy',
    description: 'Updates a notification policy. Requires NOTIFICATION_POLICY_MANAGE permission.',
    tags: ['Organization', 'Notification Policy'],
  },
  'DELETE /api/v1/tenancy/organizations/{id}/notification-policies/{policyId}': {
    summary: 'Delete notification policy',
    description: 'Deletes a notification policy. Requires NOTIFICATION_POLICY_MANAGE permission.',
    tags: ['Organization', 'Notification Policy'],
  },

  // ── Organization: Audit Logs ──
  'GET /api/v1/tenancy/organizations/{id}/audit-logs': {
    summary: 'List organization audit logs',
    description:
      'Returns a paginated list of audit log entries for the organization. Requires AUDIT_LOG_READ permission.',
    tags: ['Organization', 'Audit Log'],
  },

  // ── Membership ──
  'GET /api/v1/tenancy/organizations/{id}/memberships': {
    summary: 'List memberships',
    description:
      'Returns all memberships in the organization with their roles. Requires MEMBERSHIP_READ permission.',
    tags: ['Membership'],
  },
  'GET /api/v1/tenancy/organizations/{id}/memberships/{membershipId}': {
    summary: 'Get membership',
    description:
      'Returns a single membership including user details and role. Requires MEMBERSHIP_READ permission.',
    tags: ['Membership'],
  },
  'GET /api/v1/tenancy/organizations/{id}/memberships/{membershipId}/permissions': {
    summary: 'Get membership permissions',
    description:
      'Returns all effective permissions for a membership (from role). Requires MEMBERSHIP_READ permission.',
    tags: ['Membership'],
  },
  'POST /api/v1/tenancy/organizations/{id}/memberships': {
    summary: 'Create membership',
    description:
      'Adds a user as a member of the organization with a specific role. Requires MEMBERSHIP_MANAGE permission.',
    tags: ['Membership'],
  },
  'PATCH /api/v1/tenancy/organizations/{id}/memberships/{membershipId}': {
    summary: 'Update membership',
    description:
      'Updates a membership status (e.g. suspend or activate). Requires MEMBERSHIP_MANAGE permission.',
    tags: ['Membership'],
  },
  'DELETE /api/v1/tenancy/organizations/{id}/memberships/{membershipId}': {
    summary: 'Remove membership',
    description: 'Removes a member from the organization. Requires MEMBERSHIP_MANAGE permission.',
    tags: ['Membership'],
  },
  'POST /api/v1/tenancy/organizations/{id}/leave': {
    summary: 'Leave organization',
    description:
      'Allows the authenticated user to leave the organization. Owners cannot leave without transferring ownership first.',
    tags: ['Membership'],
  },
  'POST /api/v1/tenancy/organizations/{id}/transfer-ownership': {
    summary: 'Transfer organization ownership',
    description:
      'Transfers ownership of the organization to another member. Only the current owner can perform this action.',
    tags: ['Membership'],
  },

  // ── Member Invitations ──
  'GET /api/v1/tenancy/organizations/{id}/invitations': {
    summary: 'List invitations',
    description:
      'Returns all pending invitations for the organization. Requires INVITATION_MANAGE permission.',
    tags: ['Membership', 'Invitation'],
  },
  'POST /api/v1/tenancy/organizations/{id}/invitations': {
    summary: 'Create invitation',
    description:
      'Sends an invitation email to join the organization. Requires INVITATION_MANAGE permission.',
    tags: ['Membership', 'Invitation'],
  },
  'POST /api/v1/tenancy/invitations/{invitationId}/accept': {
    summary: 'Accept invitation',
    description:
      'Accepts a pending invitation using the invitation token. Creates a membership for the user.',
    tags: ['Membership', 'Invitation'],
  },
  'DELETE /api/v1/tenancy/organizations/{id}/invitations/{invitationId}': {
    summary: 'Cancel invitation',
    description: 'Cancels a pending invitation. Requires INVITATION_MANAGE permission.',
    tags: ['Membership', 'Invitation'],
  },
  'POST /api/v1/tenancy/organizations/{id}/invitations/{invitationId}/resend': {
    summary: 'Resend invitation',
    description:
      'Resends the invitation email with a new expiry. Requires INVITATION_MANAGE permission.',
    tags: ['Membership', 'Invitation'],
  },
  'GET /api/v1/tenancy/invitations/pending': {
    summary: 'List my pending invitations',
    description:
      'Returns all pending invitations for the authenticated user across all organizations.',
    tags: ['Membership', 'Invitation'],
  },
  'POST /api/v1/tenancy/invitations/{invitationId}/decline': {
    summary: 'Decline invitation',
    description: 'Declines a pending invitation. The invitation is marked as declined.',
    tags: ['Membership', 'Invitation'],
  },

  // ── Member Roles ──
  'GET /api/v1/tenancy/organizations/{id}/roles': {
    summary: 'List roles',
    description: 'Returns all roles defined in the organization. Requires ROLE_READ permission.',
    tags: ['Role'],
  },
  'GET /api/v1/tenancy/organizations/{id}/roles/{roleId}': {
    summary: 'Get role',
    description: 'Returns a single role with its details. Requires ROLE_READ permission.',
    tags: ['Role'],
  },
  'POST /api/v1/tenancy/organizations/{id}/roles': {
    summary: 'Create role',
    description: 'Creates a new custom role in the organization. Requires ROLE_MANAGE permission.',
    tags: ['Role'],
  },
  'PATCH /api/v1/tenancy/organizations/{id}/roles/{roleId}': {
    summary: 'Update role',
    description:
      'Updates a role name or description. System roles cannot be modified. Requires ROLE_MANAGE permission.',
    tags: ['Role'],
  },
  'DELETE /api/v1/tenancy/organizations/{id}/roles/{roleId}': {
    summary: 'Delete role',
    description:
      'Deletes a custom role. System roles cannot be deleted. Members with this role must be reassigned first. Requires ROLE_MANAGE permission.',
    tags: ['Role'],
  },

  // ── Member Role Permissions ──
  'GET /api/v1/tenancy/organizations/{id}/roles/{roleId}/permissions': {
    summary: 'List role permissions',
    description: 'Returns all permissions assigned to a role. Requires ROLE_READ permission.',
    tags: ['Role', 'Permission'],
  },
  'PUT /api/v1/tenancy/organizations/{id}/roles/{roleId}/permissions': {
    summary: 'Replace role permissions',
    description:
      'Replaces all permissions for a role with the provided set. Requires ROLE_MANAGE permission.',
    tags: ['Role', 'Permission'],
  },

  // ── Permissions ──
  'GET /api/v1/tenancy/permissions': {
    summary: 'List all permissions',
    description:
      'Returns the complete list of available permissions that can be assigned to roles.',
    tags: ['Permission'],
  },
};
