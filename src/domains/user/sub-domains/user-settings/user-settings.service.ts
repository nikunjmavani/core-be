import { NotFoundError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { UserService } from '../../user.service.js';
import type { UserSettingsRepository } from './user-settings.repository.js';
import { serializeUserSettings } from './user-settings.serializer.js';
import type { UserSettingsOutput } from './user-settings.types.js';
import { validateUpdateUserSettings } from './user-settings.validator.js';

export class UserSettingsService {
  constructor(
    private readonly userService: UserService,
    private readonly repository: UserSettingsRepository,
  ) {}

  async get(user_public_id: string): Promise<UserSettingsOutput> {
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
    const settings = await this.repository.getByUserId(user.id);
    return serializeUserSettings(settings);
  }

  async update(user_public_id: string, body: unknown): Promise<UserSettingsOutput> {
    const parsed = validateUpdateUserSettings(body);
    const user = await this.userService.findUserRecordByPublicId(user_public_id);
    if (!user) throw new NotFoundError('User');
    const result = await this.repository.upsert(user.id, omitUndefined(parsed));
    return serializeUserSettings(result);
  }
}
