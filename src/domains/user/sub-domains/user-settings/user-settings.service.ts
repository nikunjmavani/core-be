import { NotFoundError } from '@/shared/errors/index.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { UserService } from '../../user.service.js';
import type { UserSettingsRepository } from './user-settings.repository.js';
import { serializeUserSettings } from './user-settings.serializer.js';
import type { UserSettingsOutput } from './user-settings.types.js';
import { validateUpdateUserSettings } from './user-settings.validator.js';

/**
 * Read or merge the authenticated user's personalization toggles and locale preferences.
 *
 * @remarks
 * - **Algorithm:** resolve the user via {@link UserService.findUserRecordByPublicId}; `get`
 *   returns the serialized row (or platform defaults if no row exists); `update` validates the
 *   patch, drops `undefined` fields, and asks the repository to upsert-merge over the existing row.
 * - **Failure modes:** unknown user → {@link NotFoundError}; invalid body →
 *   {@link ValidationError} from the validator.
 * - **Side effects:** writes to `auth.user_settings`. No event emission today.
 * - **Notes:** the repository handles defaulting on first write so this service stays patch-only;
 *   `omitUndefined` avoids accidentally clearing fields the client did not send.
 */
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
