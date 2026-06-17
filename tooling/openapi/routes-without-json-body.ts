/**
 * OpenAPI route keys (METHOD + path with {param}) that intentionally have no JSON request body.
 * Used by generate-openapi.ts and openapi-completeness.global.test.ts.
 */
export const ROUTES_WITHOUT_JSON_BODY = new Set([
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/switch-to-personal',
  'POST /api/v1/auth/email/resend-verification',
  'POST /api/v1/auth/me/webauthn/register/options',
  'DELETE /api/v1/auth/me/sessions',
  'POST /api/v1/users/me/data-export',
  'DELETE /api/v1/users/me',
  'DELETE /api/v1/users/me/avatar',
  'POST /api/v1/users/{user_id}/suspend',
  'POST /api/v1/users/{user_id}/unsuspend',
  'POST /api/v1/uploads/{upload_id}/confirm',
  'POST /api/v1/tenancy/organization/leave',
  'POST /api/v1/tenancy/invitations/{invitation_id}/decline',
  'POST /api/v1/billing/subscriptions/{subscription_id}/cancel',
  'POST /api/v1/billing/subscriptions/{subscription_id}/resume',
  'POST /api/v1/tenancy/organization/api-keys/{api_key_id}/rotate',
  'POST /api/v1/notify/notifications/mark-all-read',
  'PATCH /api/v1/notify/notifications/{notification_id}/read',
  'POST /api/v1/notify/webhooks/{webhook_id}/test',
  'POST /api/v1/mcp',
]);
