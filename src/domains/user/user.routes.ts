import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  EXPENSIVE_AUTHED_RATE_LIMIT,
  MODERATE_AUTHED_RATE_LIMIT,
} from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { GLOBAL_ROLES } from '@/shared/constants/index.js';
import { requireRole } from '@/shared/utils/auth/authorization.util.js';
import { createUserController } from './user.controller.js';
import { createUserDataExportController } from './sub-domains/user-data-export/user-data-export.controller.js';
import { PutNotificationPreferencesDto } from './sub-domains/user-notification-preferences/user-notification-preferences.dto.js';
import { UpdateUserSettingsDto } from './sub-domains/user-settings/user-settings.dto.js';
import { AdminUpdateUserDto, UpdateMeDto, UploadAvatarDto } from './user.dto.js';

/**
 * Fastify plugin that mounts the user domain HTTP surface: admin user management routes, the
 * `/me` self-service routes (profile, settings, notification preferences, avatar), and the GDPR
 * data-export request/status endpoints. Admin routes require the `SUPER_ADMIN` or `ADMIN` global
 * role; data-export request is rate-limited via {@link EXPENSIVE_AUTHED_RATE_LIMIT}.
 */
export const userRoutesPlugin: FastifyPluginAsync = async (app) => {
  const controller = createUserController(app.userDomain);
  const dataExportController = createUserDataExportController(app.userDomain.userDataExportService);
  const zodApplication = app.withTypeProvider<ZodTypeProvider>();
  // ── Admin user routes (require admin+ role) ────────────────
  zodApplication.get(
    '/',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
      schema: {
        summary: 'List all users (admin)',
        description: 'Returns a paginated list of all users. Requires SUPER_ADMIN or ADMIN role.',
        tags: ['Admin', 'User Management'],
      },
    },
    controller.listUsers,
  );
  zodApplication.get(
    '/:userId',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
      schema: {
        summary: 'Get user by ID (admin)',
        description: "Returns a specific user's profile. Requires SUPER_ADMIN or ADMIN role.",
        tags: ['Admin', 'User Management'],
      },
    },
    controller.getUser,
  );
  zodApplication.patch(
    '/:userId',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
      schema: {
        summary: 'Update user (admin)',
        description: "Updates a user's profile or status. Requires SUPER_ADMIN or ADMIN role.",
        tags: ['Admin', 'User Management'],
        body: AdminUpdateUserDto,
      },
    },
    controller.updateUser,
  );
  zodApplication.delete(
    '/:userId',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
      schema: {
        summary: 'Delete user (admin)',
        description: 'Permanently deletes a user account. Requires SUPER_ADMIN or ADMIN role.',
        tags: ['Admin', 'User Management'],
      },
    },
    controller.deleteUser,
  );
  zodApplication.post(
    '/:userId/suspend',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
      schema: {
        summary: 'Suspend user (admin)',
        description:
          'Suspends a user account, preventing login. Requires SUPER_ADMIN or ADMIN role.',
        tags: ['Admin', 'User Management'],
      },
    },
    controller.suspendUser,
  );
  zodApplication.post(
    '/:userId/unsuspend',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
      schema: {
        summary: 'Unsuspend user (admin)',
        description: 'Reactivates a suspended user account. Requires SUPER_ADMIN or ADMIN role.',
        tags: ['Admin', 'User Management'],
      },
    },
    controller.unsuspendUser,
  );

  // ── Self-service user routes (require authenticated) ───────
  zodApplication.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Get current user profile',
        description:
          "Returns the authenticated user's profile including name, email, avatar, and account status.",
        tags: ['User'],
      },
    },
    controller.getMe,
  );
  zodApplication.patch(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Update current user profile',
        description:
          "Updates the authenticated user's profile fields (name, avatar). Email changes require verification.",
        tags: ['User'],
        body: UpdateMeDto,
      },
    },
    controller.patchMe,
  );
  zodApplication.delete(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Delete my account',
        description:
          "Permanently deletes the authenticated user's account and all associated data. This action is irreversible.",
        tags: ['User'],
      },
    },
    controller.deleteMe,
  );
  zodApplication.get(
    '/me/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Get my settings',
        description:
          "Returns the authenticated user's personal settings (dark mode, language, notification preferences).",
        tags: ['User', 'User Settings'],
      },
    },
    controller.getSettings,
  );
  zodApplication.patch(
    '/me/settings',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Update my settings',
        description: "Updates the authenticated user's personal settings.",
        tags: ['User', 'User Settings'],
        body: UpdateUserSettingsDto,
      },
    },
    controller.patchSettings,
  );
  zodApplication.get(
    '/me/notification-preferences',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Get my notification preferences',
        description:
          "Returns the authenticated user's notification preferences per type and channel.",
        tags: ['User', 'Notification Preferences'],
      },
    },
    controller.getNotificationPreferences,
  );
  zodApplication.put(
    '/me/notification-preferences',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Replace notification preferences',
        description:
          'Replaces all notification preferences for the authenticated user. Sends a complete set of preferences.',
        tags: ['User', 'Notification Preferences'],
        body: PutNotificationPreferencesDto,
      },
    },
    controller.putNotificationPreferences,
  );
  zodApplication.put(
    '/me/avatar',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Upload avatar',
        description: "Uploads or replaces the authenticated user's avatar image.",
        tags: ['User'],
        body: UploadAvatarDto,
      },
    },
    controller.uploadAvatar,
  );
  zodApplication.delete(
    '/me/avatar',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Remove avatar',
        description: "Removes the authenticated user's avatar image.",
        tags: ['User'],
      },
    },
    controller.deleteAvatar,
  );

  // ── GDPR / Privacy ─────────────────────────────────────────
  zodApplication.post(
    '/me/data-export',
    {
      onRequest: [app.authenticate],
      ...EXPENSIVE_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Request GDPR data export',
        description:
          'Enqueues an async export of all personal data. Poll GET /users/me/data-export/{exportId} for status and a time-limited download URL (15-minute lifetime).',
        tags: ['User', 'Privacy'],
      },
    },
    dataExportController.requestExport,
  );
  zodApplication.get(
    '/me/data-export/:exportId',
    {
      onRequest: [app.authenticate],
      // sec-U6: every successful poll while status === COMPLETED mints a fresh
      // presigned download URL. Without a rate limit, a session-token holder
      // could spin the poll loop to mint URLs indefinitely; cap at the
      // moderate-authed tier (30 req / 60s) so the typical UI poll cadence
      // (a few seconds while the user waits) is unaffected but bulk-replay
      // mints are bounded.
      ...MODERATE_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Get GDPR data export status',
        description:
          'Returns export job status. When completed, includes a presigned download URL for the gzip JSON artifact (15-minute lifetime; every mint is audited as `user.data_export.url_minted`).',
        tags: ['User', 'Privacy'],
      },
    },
    dataExportController.getExportStatus,
  );
};
