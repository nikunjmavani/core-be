import type { FastifyInstance } from 'fastify';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import { getDefaultS3ObjectStorageAdapter } from '@/infrastructure/storage/s3-adapter.js';
import { UserRepository } from './user.repository.js';
import { UserSettingsRepository } from './sub-domains/user-settings/user-settings.repository.js';
import { UserNotificationPreferencesRepository } from './sub-domains/user-notification-preferences/user-notification-preferences.repository.js';
import { UserService } from './user.service.js';
import { UserSettingsService } from './sub-domains/user-settings/user-settings.service.js';
import { UserNotificationPreferencesService } from './sub-domains/user-notification-preferences/user-notification-preferences.service.js';
import { UserDataExportService } from './sub-domains/user-data-export/user-data-export.service.js';
import { UserDataExportRepository } from './sub-domains/user-data-export/user-data-export.repository.js';

/** Public DI surface: services only (repository stays inside the user domain). */
export type UserContainer = {
  userService: UserService;
  userSettingsService: UserSettingsService;
  userNotificationPreferencesService: UserNotificationPreferencesService;
  userDataExportService: UserDataExportService;
};

/** Internal DI surface that also exposes {@link UserRepository} for tests and offboarding wiring. */
export type UserContainerWithRepository = UserContainer & {
  userRepository: UserRepository;
};

/**
 * Partial container produced before the `userDataExportService` is constructed — used to break
 * the cycle between user-data-export (which needs `UserService`) and the rest of the user domain.
 */
export type UserContainerBase = Omit<UserContainerWithRepository, 'userDataExportService'>;

/**
 * Wire the core user domain (repository + services minus data-export) so callers can construct
 * `UserDataExportService` against the resulting `userService` before completing the container.
 */
export function createUserContainerBase(objectStorage: ObjectStoragePort): UserContainerBase {
  const userRepository = new UserRepository();
  const userSettingsRepository = new UserSettingsRepository();
  const userNotificationPreferencesRepository = new UserNotificationPreferencesRepository();

  const userService = new UserService(userRepository, objectStorage);
  const userSettingsService = new UserSettingsService(userService, userSettingsRepository);
  const userNotificationPreferencesService = new UserNotificationPreferencesService(
    userService,
    userNotificationPreferencesRepository,
  );

  return {
    userRepository,
    userService,
    userSettingsService,
    userNotificationPreferencesService,
  };
}

/** Attach a constructed {@link UserDataExportService} to a base container produced by {@link createUserContainerBase}. */
export function completeUserContainer(
  base: UserContainerBase,
  userDataExportService: UserDataExportService,
): UserContainerWithRepository {
  return { ...base, userDataExportService };
}

/**
 * Build the full user-domain container in one shot for the standard case (HTTP startup).
 * Constructs the data-export service against the freshly-built {@link UserService} and returns
 * the public surface (services only — the repository is hidden by `UserContainer`).
 */
export function createUserContainer(objectStorage: ObjectStoragePort): UserContainer {
  const base = createUserContainerBase(objectStorage);
  const userDataExportRepository = new UserDataExportRepository();
  const userDataExportService = new UserDataExportService(
    base.userService,
    userDataExportRepository,
    objectStorage,
  );
  const withRepository = completeUserContainer(base, userDataExportService);
  return {
    userService: withRepository.userService,
    userSettingsService: withRepository.userSettingsService,
    userNotificationPreferencesService: withRepository.userNotificationPreferencesService,
    userDataExportService: withRepository.userDataExportService,
  };
}

/**
 * Register the user-domain container as `app.userDomain` on the Fastify instance.
 * Uses the default S3 object-storage adapter; consumers (routes, plugins) read services off the
 * decorated `userDomain` rather than reaching into individual modules.
 */
export function registerUserContainer(application: FastifyInstance): void {
  application.decorate('userDomain', createUserContainer(getDefaultS3ObjectStorageAdapter()));
}
