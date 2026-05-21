/**
 * OpenAPI route keys (METHOD + path with {param}) that intentionally have no JSON request body.
 * Used by generate-openapi.ts and openapi-completeness.global.test.ts.
 */
export const ROUTES_WITHOUT_JSON_BODY = new Set([
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/email/resend-verification',
  'POST /api/v1/auth/webauthn/register/options',
  'DELETE /api/v1/auth/me/sessions',
  'POST /api/v1/users/me/data-export',
  'DELETE /api/v1/users/me',
  'DELETE /api/v1/users/me/avatar',
  'POST /api/v1/users/{userId}/suspend',
  'POST /api/v1/users/{userId}/unsuspend',
  'POST /api/v1/uploads/{publicId}/confirm',
  'POST /api/v1/tenancy/organizations/{id}/leave',
  'POST /api/v1/tenancy/invitations/{invitationId}/decline',
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/cancel',
  'POST /api/v1/billing/organizations/{id}/subscriptions/{subscriptionId}/resume',
  'POST /api/v1/tenancy/organizations/{id}/api-keys/{apiKeyId}/rotate',
  'POST /api/v1/notify/notifications/mark-all-read',
  'PATCH /api/v1/notify/notifications/{id}/read',
  'POST /api/v1/notify/organizations/{id}/webhooks/{webhookId}/test',
  'POST /api/v1/billing/stripe/webhook',
  'POST /api/v1/mcp',
]);
