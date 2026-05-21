/** OpenAPI route metadata — user and admin. */
import type { RouteMetadata } from './types.js';

export const userAdminMetadata: Record<string, RouteMetadata> = {
  // ── User: Me ──
  'GET /api/v1/users/me': {
    summary: 'Get current user profile',
    description:
      "Returns the authenticated user's profile including name, email, avatar, and account status.",
    tags: ['User'],
  },
  'PATCH /api/v1/users/me': {
    summary: 'Update current user profile',
    description:
      "Updates the authenticated user's profile fields (name, avatar). Email changes require verification.",
    tags: ['User'],
  },
  'DELETE /api/v1/users/me': {
    summary: 'Delete my account',
    description:
      "Permanently deletes the authenticated user's account and all associated data. This action is irreversible.",
    tags: ['User'],
  },
  'GET /api/v1/users/me/settings': {
    summary: 'Get my settings',
    description:
      "Returns the authenticated user's personal settings (dark mode, language, notification preferences).",
    tags: ['User', 'User Settings'],
  },
  'PATCH /api/v1/users/me/settings': {
    summary: 'Update my settings',
    description: "Updates the authenticated user's personal settings.",
    tags: ['User', 'User Settings'],
  },
  'GET /api/v1/users/me/notification-preferences': {
    summary: 'Get my notification preferences',
    description: "Returns the authenticated user's notification preferences per type and channel.",
    tags: ['User', 'Notification Preferences'],
  },
  'PUT /api/v1/users/me/notification-preferences': {
    summary: 'Replace notification preferences',
    description:
      'Replaces all notification preferences for the authenticated user. Sends a complete set of preferences.',
    tags: ['User', 'Notification Preferences'],
  },
  'PUT /api/v1/users/me/avatar': {
    summary: 'Upload avatar',
    description: "Uploads or replaces the authenticated user's avatar image.",
    tags: ['User'],
  },
  'DELETE /api/v1/users/me/avatar': {
    summary: 'Remove avatar',
    description: "Removes the authenticated user's avatar image.",
    tags: ['User'],
  },
  'POST /api/v1/users/me/data-export': {
    summary: 'Request GDPR data export',
    description:
      'Enqueues an async export of all personal data. Poll GET /users/me/data-export/{exportId} for status and a time-limited download URL (≤24h).',
    tags: ['User', 'Privacy'],
  },
  'GET /api/v1/users/me/data-export/{exportId}': {
    summary: 'Get GDPR data export status',
    description:
      'Returns export job status. When completed, includes a presigned download URL for the gzip JSON artifact.',
    tags: ['User', 'Privacy'],
  },

  // ── Admin: Users ──
  'GET /api/v1/users': {
    summary: 'List all users (admin)',
    description: 'Returns a paginated list of all users. Requires SUPER_ADMIN or ADMIN role.',
    tags: ['Admin', 'User Management'],
  },
  'GET /api/v1/users/{userId}': {
    summary: 'Get user by ID (admin)',
    description: "Returns a specific user's profile. Requires SUPER_ADMIN or ADMIN role.",
    tags: ['Admin', 'User Management'],
  },
  'PATCH /api/v1/users/{userId}': {
    summary: 'Update user (admin)',
    description: "Updates a user's profile or status. Requires SUPER_ADMIN or ADMIN role.",
    tags: ['Admin', 'User Management'],
  },
  'DELETE /api/v1/users/{userId}': {
    summary: 'Delete user (admin)',
    description: 'Permanently deletes a user account. Requires SUPER_ADMIN or ADMIN role.',
    tags: ['Admin', 'User Management'],
  },
  'POST /api/v1/users/{userId}/suspend': {
    summary: 'Suspend user (admin)',
    description: 'Suspends a user account, preventing login. Requires SUPER_ADMIN or ADMIN role.',
    tags: ['Admin', 'User Management'],
  },
  'POST /api/v1/users/{userId}/unsuspend': {
    summary: 'Unsuspend user (admin)',
    description: 'Reactivates a suspended user account. Requires SUPER_ADMIN or ADMIN role.',
    tags: ['Admin', 'User Management'],
  },
};
