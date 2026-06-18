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
  'POST /api/v1/auth/me/mfa/verify': MfaVerifyDto,
  'POST /api/v1/auth/me/mfa/enroll': MfaEnrollDto,
  'POST /api/v1/auth/mfa/login': MfaLoginVerifyDto,
  'POST /api/v1/auth/password/forgot': ForgotPasswordDto,
  'POST /api/v1/auth/password/reset': ResetPasswordDto,
  'POST /api/v1/auth/password/change': ChangePasswordDto,
  'POST /api/v1/auth/email/verify': VerifyEmailDto,
  'POST /api/v1/auth/webauthn/authenticate/options': webauthnAuthenticateOptionsDto,
  'POST /api/v1/auth/webauthn/authenticate/verify': webauthnAuthenticateVerifyDto,
  'POST /api/v1/auth/me/webauthn/register/verify': webauthnRegisterVerifyDto,

  // ── Auth: Me (auth-specific) ──
  'POST /api/v1/auth/me/auth-methods': CreateAuthMethodDto,

  // ── User: Me (profile) ──
  'PATCH /api/v1/users/me': UpdateMeDto,
  'PATCH /api/v1/users/me/settings': UpdateUserSettingsDto,
  'PUT /api/v1/users/me/notification-preferences': PutNotificationPreferencesDto,

  // ── Admin: Users ──
  'PATCH /api/v1/users/{user_id}': AdminUpdateUserDto,

  // ── Organizations ──
  'POST /api/v1/tenancy/organizations': createOrganizationDto,
  'PATCH /api/v1/tenancy/organization': updateOrganizationDto,
  'PUT /api/v1/tenancy/organization/logo': uploadLogoDto,
  'PATCH /api/v1/tenancy/organization/settings': updateOrganizationSettingsDto,

  // ── Organization: API Keys ──
  'POST /api/v1/tenancy/organization/api-keys': createOrganizationApiKeyDto,
  'PATCH /api/v1/tenancy/organization/api-keys/{api_key_id}': updateOrganizationApiKeyDto,

  // ── Organization: Notification Policies ──
  'POST /api/v1/tenancy/organization/notification-policies':
    createOrganizationNotificationPolicyDto,
  'PATCH /api/v1/tenancy/organization/notification-policies/{notification_policy_id}':
    updateOrganizationNotificationPolicyDto,

  // ── Memberships ──
  'POST /api/v1/tenancy/organization/memberships': createMembershipDto,
  'PATCH /api/v1/tenancy/organization/memberships/{membership_id}': updateMembershipDto,
  'POST /api/v1/tenancy/organization/transfer-ownership': transferOwnershipDto,

  // ── Invitations ──
  'POST /api/v1/tenancy/organization/invitations': createMemberInvitationDto,
  'POST /api/v1/tenancy/invitations/{invitation_id}/accept': acceptMemberInvitationDto,
  'POST /api/v1/tenancy/organization/invitations/{invitation_id}/resend': resendMemberInvitationDto,

  // ── Roles ──
  'POST /api/v1/tenancy/organization/roles': createMemberRoleDto,
  'PATCH /api/v1/tenancy/organization/roles/{role_id}': updateMemberRoleDto,
  'PUT /api/v1/tenancy/organization/roles/{role_id}/permissions': putMemberRolePermissionsDto,

  // ── Billing: Subscriptions ──
  'POST /api/v1/billing/subscriptions': CreateSubscriptionDto,
  'PATCH /api/v1/billing/subscriptions/{subscription_id}': UpdateSubscriptionDto,
  'POST /api/v1/billing/subscriptions/{subscription_id}/change-plan': ChangePlanDto,

  // ── Webhooks ──
  'POST /api/v1/notify/webhooks': CreateWebhookDto,
  'PATCH /api/v1/notify/webhooks/{webhook_id}': UpdateWebhookDto,

  // ── Upload ──
  'POST /api/v1/uploads': createUploadDto,

  // ── User: Avatar & export ──
  'PUT /api/v1/users/me/avatar': UploadAvatarDto,
  'POST /api/v1/users/me/data-export': exportUserDataBodyDto,
};
