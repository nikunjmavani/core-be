/**
 * Organization-scoped permission codes guarded by the notify domain — used by
 * `requireOrganizationPermission` preHandlers on webhook routes.
 */
export const NOTIFY_PERMISSIONS = {
  WEBHOOK_READ: 'webhook:read',
  WEBHOOK_MANAGE: 'webhook:manage',
} as const;
