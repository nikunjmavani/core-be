import { NotFoundError } from '@/shared/errors/index.js';
import type { UserService } from '../../user.service.js';
import type { UserNotificationPreferencesRepository } from './user-notification-preferences.repository.js';
import { serializeUserNotificationPreferenceList } from './user-notification-preferences.serializer.js';
import type { NotificationPreferenceOutput } from './user-notification-preferences.types.js';
import { validatePutUserNotificationPreferences } from './user-notification-preferences.validator.js';

export class UserNotificationPreferencesService {
  constructor(
    private readonly userService: UserService,
    private readonly repository: UserNotificationPreferencesRepository,
  ) {}

  async get(user_public_id: string): Promise<NotificationPreferenceOutput[]> {
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
    const rows = await this.repository.listByUserId(user.id);
    return serializeUserNotificationPreferenceList(rows);
  }

  async put(user_public_id: string, body: unknown): Promise<NotificationPreferenceOutput[]> {
    const parsed = validatePutUserNotificationPreferences(body);
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
    const rows = await this.repository.replaceAll(
      user.id,
      parsed.preferences.map((preference) => ({
        notification_type: preference.notification_type,
        channel: preference.channel,
        organization_id: preference.organization_id ?? null,
        is_enabled: preference.is_enabled,
      })),
      user.id,
    );
    return serializeUserNotificationPreferenceList(rows);
  }
}
