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

export type UserContainerWithRepository = UserContainer & {
  userRepository: UserRepository;
};

export type UserContainerBase = Omit<UserContainerWithRepository, 'userDataExportService'>;

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

export function completeUserContainer(
  base: UserContainerBase,
  userDataExportService: UserDataExportService,
): UserContainerWithRepository {
  return { ...base, userDataExportService };
}

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

export function registerUserContainer(application: FastifyInstance): void {
  application.decorate('userDomain', createUserContainer(getDefaultS3ObjectStorageAdapter()));
}
