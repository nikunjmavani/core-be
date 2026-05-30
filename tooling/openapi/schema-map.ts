/**
 * Maps OpenAPI route patterns (method + path) to their Zod request body DTOs.
 *
 * Used by generate-openapi.ts to embed JSON Schemas from Zod DTOs,
 * which openapi-to-postmanv2's built-in schemaFaker turns into realistic examples.
 *
 * When adding a new route with a body, add its mapping here.
 */
import type { ZodTypeAny } from 'zod';

// ─── Auth ──────────────────────────────────────────────────────────────
import {
  LoginDto,
  MagicLinkSendDto,
  MagicLinkVerifyDto,
  MfaVerifyDto,
  CreateAuthMethodDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  VerifyEmailDto,
  MfaEnrollDto,
  MfaLoginVerifyDto,
} from '@/domains/auth/auth.dto.js';

// ─── User ──────────────────────────────────────────────────────────────
import { UpdateMeDto, AdminUpdateUserDto, UploadAvatarDto } from '@/domains/user/user.dto.js';
import { UpdateUserSettingsDto } from '@/domains/user/sub-domains/user-settings/user-settings.dto.js';
import { PutNotificationPreferencesDto } from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.dto.js';
import { exportUserDataBodyDto } from '@/domains/user/sub-domains/user-data-export/user-data-export.dto.js';
import {
  webauthnAuthenticateOptionsDto,
  webauthnAuthenticateVerifyDto,
  webauthnRegisterVerifyDto,
} from '@/domains/auth/sub-domains/auth-webauthn/webauthn.dto.js';

// ─── Tenancy: Organization ─────────────────────────────────────────────
import {
  createOrganizationDto,
  updateOrganizationDto,
  uploadLogoDto,
} from '@/domains/tenancy/sub-domains/organization/organization.dto.js';

import { updateOrganizationSettingsDto } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.dto.js';

import {
  createOrganizationNotificationPolicyDto,
  updateOrganizationNotificationPolicyDto,
} from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.dto.js';

import {
  createOrganizationApiKeyDto,
  updateOrganizationApiKeyDto,
} from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.dto.js';

// ─── Tenancy: Membership ───────────────────────────────────────────────
import {
  createMembershipDto,
  updateMembershipDto,
  transferOwnershipDto,
} from '@/domains/tenancy/sub-domains/membership/membership.dto.js';

import {
  createMemberInvitationDto,
  acceptMemberInvitationDto,
  resendMemberInvitationDto,
} from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.dto.js';

// ─── Tenancy: Roles & Permissions ──────────────────────────────────────
import {
  createMemberRoleDto,
  updateMemberRoleDto,
} from '@/domains/tenancy/sub-domains/member-roles/member-role.dto.js';

import { putMemberRolePermissionsDto } from '@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.dto.js';

// ─── Billing ───────────────────────────────────────────────────────────
import {
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  ChangePlanDto,
} from '@/domains/billing/sub-domains/subscription/subscription.dto.js';

// ─── Upload ────────────────────────────────────────────────────────────
import { createUploadDto } from '@/domains/upload/upload.dto.js';

// ─── Notify ────────────────────────────────────────────────────────────
import {
  CreateWebhookDto,
  UpdateWebhookDto,
} from '@/domains/notify/sub-domains/webhook/webhook.dto.js';

/**
 * Route key format: "METHOD /openapi/path" (with {param} placeholders).
 * Value: Zod schema for the request body.
 */
export const routeSchemaMap: Record<string, ZodTypeAny> = {
  // ── Auth ──
  'POST /api/v1/auth/login': LoginDto,
  'POST /api/v1/auth/magic-link/send': MagicLinkSendDto,
  'POST /api/v1/auth/magic-link/verify': MagicLinkVerifyDto,
  'POST /api/v1/auth/mfa/verify': MfaVerifyDto,
  'POST /api/v1/auth/mfa/enroll': MfaEnrollDto,
  'POST /api/v1/auth/mfa/login': MfaLoginVerifyDto,
  'POST /api/v1/auth/password/forgot': ForgotPasswordDto,
  'POST /api/v1/auth/password/reset': ResetPasswordDto,
  'POST /api/v1/auth/password/change': ChangePasswordDto,
  'POST /api/v1/auth/email/verify': VerifyEmailDto,
  'POST /api/v1/auth/webauthn/authenticate/options': webauthnAuthenticateOptionsDto,
  'POST /api/v1/auth/webauthn/authenticate/verify': webauthnAuthenticateVerifyDto,
  'POST /api/v1/auth/webauthn/register/verify': webauthnRegisterVerifyDto,

  // ── Auth: Me (auth-specific) ──
  'POST /api/v1/auth/me/auth-methods': CreateAuthMethodDto,

  // ── User: Me (profile) ──
  'PATCH /api/v1/users/me': UpdateMeDto,
  'PATCH /api/v1/users/me/settings': UpdateUserSettingsDto,
  'PUT /api/v1/users/me/notification-preferences': PutNotificationPreferencesDto,

  // ── Admin: Users ──
  'PATCH /api/v1/users/{userId}': AdminUpdateUserDto,

  // ── Organizations ──
  'POST /api/v1/tenancy/organizations': createOrganizationDto,
  'PATCH /api/v1/tenancy/organizations/{id}': updateOrganizationDto,
  'PUT /api/v1/tenancy/organizations/{id}/logo': uploadLogoDto,
  'PATCH /api/v1/tenancy/organizations/{id}/settings': updateOrganizationSettingsDto,

  // ── Organization: API Keys ──
  'POST /api/v1/tenancy/organizations/{id}/api-keys': createOrganizationApiKeyDto,
  'PATCH /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}': updateOrganizationApiKeyDto,

  // ── Organization: Notification Policies ──
  'POST /api/v1/tenancy/organizations/{id}/notification-policies':
    createOrganizationNotificationPolicyDto,
  'PATCH /api/v1/tenancy/organizations/{id}/notification-policies/{policyId}':
    updateOrganizationNotificationPolicyDto,

  // ── Memberships ──
  'POST /api/v1/tenancy/organizations/{id}/memberships': createMembershipDto,
  'PATCH /api/v1/tenancy/organizations/{id}/memberships/{membershipId}': updateMembershipDto,
  'POST /api/v1/tenancy/organizations/{id}/transfer-ownership': transferOwnershipDto,

  // ── Invitations ──
  'POST /api/v1/tenancy/organizations/{id}/invitations': createMemberInvitationDto,
  'POST /api/v1/tenancy/invitations/{invitationId}/accept': acceptMemberInvitationDto,
  'POST /api/v1/tenancy/organizations/{id}/invitations/{invitationId}/resend':
    resendMemberInvitationDto,

  // ── Roles ──
  'POST /api/v1/tenancy/organizations/{id}/roles': createMemberRoleDto,
  'PATCH /api/v1/tenancy/organizations/{id}/roles/{roleId}': updateMemberRoleDto,
  'PUT /api/v1/tenancy/organizations/{id}/roles/{roleId}/permissions': putMemberRolePermissionsDto,

  // ── Billing: Subscriptions ──
  'POST /api/v1/billing/organizations/{id}/subscriptions': CreateSubscriptionDto,
  'PATCH /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}': UpdateSubscriptionDto,
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/change-plan':
    ChangePlanDto,

  // ── Webhooks ──
  'POST /api/v1/notify/organizations/{id}/webhooks': CreateWebhookDto,
  'PATCH /api/v1/notify/organizations/{id}/webhooks/{webhookId}': UpdateWebhookDto,

  // ── Upload ──
  'POST /api/v1/uploads': createUploadDto,

  // ── User: Avatar & export ──
  'PUT /api/v1/users/me/avatar': UploadAvatarDto,
  'POST /api/v1/users/me/data-export': exportUserDataBodyDto,
};
