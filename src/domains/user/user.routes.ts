import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { EXPENSIVE_AUTHED_RATE_LIMIT } from '@/shared/middlewares/rate-limit-presets.constants.js';
import { GLOBAL_ROLES } from '@/shared/constants/index.js';
import { requireRole } from '@/shared/utils/auth/authorization.util.js';
import { createUserController } from './user.controller.js';
import { createUserDataExportController } from './sub-domains/user-data-export/user-data-export.controller.js';
import { PutNotificationPreferencesDto } from './sub-domains/user-notification-preferences/user-notification-preferences.dto.js';
import { UpdateUserSettingsDto } from './sub-domains/user-settings/user-settings.dto.js';
import { AdminUpdateUserDto, UpdateMeDto, UploadAvatarDto } from './user.dto.js';

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
    },
    controller.listUsers,
  );
  zodApplication.get(
    '/:userId',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
    },
    controller.getUser,
  );
  zodApplication.patch(
    '/:userId',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
      schema: { body: AdminUpdateUserDto },
    },
    controller.updateUser,
  );
  zodApplication.delete(
    '/:userId',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
    },
    controller.deleteUser,
  );
  zodApplication.post(
    '/:userId/suspend',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
    },
    controller.suspendUser,
  );
  zodApplication.post(
    '/:userId/unsuspend',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRole(GLOBAL_ROLES.SUPER_ADMIN, GLOBAL_ROLES.ADMIN)],
    },
    controller.unsuspendUser,
  );

  // ── Self-service user routes (require authenticated) ───────
  zodApplication.get('/me', { onRequest: [app.authenticate] }, controller.getMe);
  zodApplication.patch(
    '/me',
    { onRequest: [app.authenticate], schema: { body: UpdateMeDto } },
    controller.patchMe,
  );
  zodApplication.delete('/me', { onRequest: [app.authenticate] }, controller.deleteMe);
  zodApplication.get('/me/settings', { onRequest: [app.authenticate] }, controller.getSettings);
  zodApplication.patch(
    '/me/settings',
    { onRequest: [app.authenticate], schema: { body: UpdateUserSettingsDto } },
    controller.patchSettings,
  );
  zodApplication.get(
    '/me/notification-preferences',
    { onRequest: [app.authenticate] },
    controller.getNotificationPreferences,
  );
  zodApplication.put(
    '/me/notification-preferences',
    { onRequest: [app.authenticate], schema: { body: PutNotificationPreferencesDto } },
    controller.putNotificationPreferences,
  );
  zodApplication.put(
    '/me/avatar',
    { onRequest: [app.authenticate], schema: { body: UploadAvatarDto } },
    controller.uploadAvatar,
  );
  zodApplication.delete('/me/avatar', { onRequest: [app.authenticate] }, controller.deleteAvatar);

  // ── GDPR / Privacy ─────────────────────────────────────────
  zodApplication.post(
    '/me/data-export',
    { onRequest: [app.authenticate], ...EXPENSIVE_AUTHED_RATE_LIMIT },
    dataExportController.requestExport,
  );
  zodApplication.get(
    '/me/data-export/:exportId',
    { onRequest: [app.authenticate] },
    dataExportController.getExportStatus,
  );
};
