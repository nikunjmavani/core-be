import { NotFoundError, ValidationError } from '@/shared/errors/index.js';
import type { ObjectStoragePort } from '@/infrastructure/storage/object-storage.port.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { buildUserAvatarKeyPrefix } from '@/domains/upload/upload.constants.js';
import type { UserRepository } from './user.repository.js';
import { UserSerializer } from './user.serializer.js';
import {
  validateUpdateMe,
  validateListUsers,
  validateAdminUpdateUser,
  validateUploadAvatar,
} from './user.validator.js';
import type { UserAuthRecord, UserOutput } from './user.types.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { AuthMethodService } from '@/domains/auth/sub-domains/auth-method/auth-method.service.js';
import type { UploadService } from '@/domains/upload/upload.service.js';
import type { UserDataExportService } from '@/domains/user/sub-domains/user-data-export/user-data-export.service.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import { withTransaction } from '@/infrastructure/database/transaction.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';

const ALLOWED_AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type UserOffboardingDependencies = {
  authSessionService: AuthSessionService;
  authMethodService: AuthMethodService;
  uploadService: UploadService;
  userDataExportService: UserDataExportService;
};

export class UserService {
  private offboardingUploadService: UploadService | null = null;
  private offboardingUserDataExportService: UserDataExportService | null = null;
  private authSessionService: AuthSessionService | null = null;
  private authMethodService: AuthMethodService | null = null;

  constructor(
    private readonly repository: UserRepository,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  wireOffboardingServices(dependencies: UserOffboardingDependencies): void {
    this.authSessionService = dependencies.authSessionService;
    this.authMethodService = dependencies.authMethodService;
    this.offboardingUploadService = dependencies.uploadService;
    this.offboardingUserDataExportService = dependencies.userDataExportService;
  }

  private get offboardingDependencies(): UserOffboardingDependencies | null {
    if (
      !(
        this.authSessionService &&
        this.authMethodService &&
        this.offboardingUploadService &&
        this.offboardingUserDataExportService
      )
    ) {
      return null;
    }
    return {
      authSessionService: this.authSessionService,
      authMethodService: this.authMethodService,
      uploadService: this.offboardingUploadService,
      userDataExportService: this.offboardingUserDataExportService,
    };
  }

  private async clearAvatarStorage(public_id: string, avatar_url: string | null): Promise<void> {
    if (!avatar_url) return;
    const expectedPrefix = buildUserAvatarKeyPrefix(public_id);
    if (!avatar_url.startsWith(expectedPrefix)) return;
    const objectDeleted = await this.objectStorage.deleteObject(avatar_url);
    if (!objectDeleted) {
      logger.warn(
        { publicId: public_id, avatarKey: avatar_url },
        'user.offboarding.avatarDeleteFailed',
      );
    }
    await this.repository.update(public_id, { avatar_url: null });
  }

  private async runOffboarding(
    public_id: string,
    user_id: number,
    avatar_url: string | null,
  ): Promise<void> {
    if (!this.offboardingDependencies) return;
    await this.clearAvatarStorage(public_id, avatar_url);
    await this.offboardingDependencies.authSessionService.revokeAllSessions(public_id);
    await this.offboardingDependencies.authMethodService.revokeAllForUser(public_id);
    await this.offboardingDependencies.uploadService.tombstoneAllByUserId(user_id);
    await this.offboardingDependencies.userDataExportService.deleteAllExportsForUser(user_id);
  }

  private async softDeleteUserWithOffboarding(public_id: string): Promise<void> {
    const user = await this.repository.findByPublicId(public_id);
    if (!user) throw new NotFoundError('User');
    if (!this.offboardingDependencies) {
      const deleted = await this.repository.softDelete(public_id);
      if (!deleted) throw new NotFoundError('User');
      return;
    }
    await this.clearAvatarStorage(public_id, user.avatar_url);
    await this.offboardingDependencies.authSessionService.revokeAllSessions(public_id);
    await this.offboardingDependencies.authMethodService.revokeAllForUser(public_id);
    await withTransaction(async () => {
      await this.offboardingDependencies!.uploadService.tombstoneAllByUserId(user.id);
      await this.offboardingDependencies!.userDataExportService.deleteAllExportsForUser(user.id);
      const deleted = await this.repository.softDelete(public_id);
      if (!deleted) throw new NotFoundError('User');
    });
  }

  // ── Cross-domain read/write (auth, audit, notify, tenancy) ───

  async findByEmail(email: string): Promise<UserAuthRecord | null> {
    return this.repository.findByEmail(email);
  }

  async findById(identifier: number): Promise<UserAuthRecord | null> {
    return this.repository.findById(identifier);
  }

  async findUserRecordByPublicId(public_id: string): Promise<UserAuthRecord | null> {
    return this.repository.findByPublicId(public_id);
  }

  async requireUserRecordByPublicId(public_id: string): Promise<UserAuthRecord> {
    const user = await this.repository.findByPublicId(public_id);
    if (!user || user.deleted_at) throw new NotFoundError('User');
    return user;
  }

  async createFromOAuth(data: {
    email: string;
    first_name?: string;
    last_name?: string;
    avatar_url?: string;
    is_email_verified: boolean;
  }): Promise<UserAuthRecord> {
    return this.repository.createFromOAuth(data);
  }

  async updatePassword(public_id: string, password_hash: string): Promise<UserAuthRecord | null> {
    return withUserDatabaseContext(public_id, () =>
      this.repository.updatePassword(public_id, password_hash),
    );
  }

  async updateLoginAttempt(
    public_id: string,
    failed_login_count: number,
    account_locked_until: Date | null,
  ): Promise<UserAuthRecord | null> {
    return this.repository.updateLoginAttempt(public_id, failed_login_count, account_locked_until);
  }

  async updateMfaEnabled(public_id: string, enabled: boolean): Promise<UserAuthRecord | null> {
    return withUserDatabaseContext(public_id, () =>
      this.repository.updateMfaEnabled(public_id, enabled),
    );
  }

  async updateEmailVerified(public_id: string): Promise<UserAuthRecord | null> {
    return this.repository.updateEmailVerified(public_id);
  }

  async resolveInternalIdByPublicId(public_id: string): Promise<number | null> {
    const user = await this.repository.findByPublicId(public_id);
    return user?.id ?? null;
  }

  private async assertAvatarObjectInStorage(
    avatarKey: string,
    ownerPublicId: string,
  ): Promise<void> {
    const expectedPrefix = buildUserAvatarKeyPrefix(ownerPublicId);
    if (!avatarKey.startsWith(expectedPrefix)) {
      throw new ValidationError('errors:validation.avatarKeyNotOwned', undefined, {
        avatarKey: ['Avatar key does not belong to this user'],
      });
    }
    if (!this.offboardingUploadService) {
      throw new Error('UploadService is not wired for avatar-attach confirmation');
    }
    // External I/O (S3) runs outside the DB context; the confirmed-status read of the
    // user-scoped upload row runs in the user context so the owner RLS policy applies.
    const objectInfo = await this.objectStorage.headObject(avatarKey);
    if (!objectInfo) {
      throw new ValidationError('errors:validation.avatarNotFound');
    }
    if (
      objectInfo.contentType &&
      !ALLOWED_AVATAR_CONTENT_TYPES.includes(
        objectInfo.contentType as (typeof ALLOWED_AVATAR_CONTENT_TYPES)[number],
      )
    ) {
      throw new ValidationError(
        'errors:validation.avatarInvalidContentType',
        { contentType: objectInfo.contentType },
        `Invalid avatar content type: ${objectInfo.contentType}`,
      );
    }
    await withUserDatabaseContext(ownerPublicId, () =>
      this.offboardingUploadService!.assertKeyConfirmed(avatarKey),
    );
  }

  // ── Self-service ────────────────────────────────────────────

  async getMe(publicId: string): Promise<UserOutput> {
    const user = await this.repository.findByPublicId(publicId);
    if (!user || user.deleted_at) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  async updateMe(publicId: string, body: unknown): Promise<UserOutput> {
    const parsed = validateUpdateMe(body);

    const { avatarKey, ...profileFields } = parsed;
    let avatarUrl: string | undefined;
    if (avatarKey) {
      await this.assertAvatarObjectInStorage(avatarKey, publicId);
      avatarUrl = avatarKey;
    }
    const user = await this.repository.update(
      publicId,
      omitUndefined({
        ...profileFields,
        ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
      }),
    );
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  async deleteMe(publicId: string): Promise<void> {
    await this.softDeleteUserWithOffboarding(publicId);
  }

  async uploadAvatar(publicId: string, body: unknown): Promise<UserOutput> {
    const { avatarKey } = validateUploadAvatar(body);
    await this.assertAvatarObjectInStorage(avatarKey, publicId);
    const user = await this.repository.update(publicId, { avatar_url: avatarKey });
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  async deleteAvatar(publicId: string): Promise<UserOutput> {
    const user = await this.repository.update(publicId, { avatar_url: null });
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  // ── Admin operations ────────────────────────────────────────

  async listUsers(query: unknown) {
    const parsed = validateListUsers(query);
    const page = parsed.page ?? 1;
    const result = await this.repository.findMany(
      omitUndefined({
        page,
        limit: parsed.limit,
        status: parsed.status,
        search: parsed.search,
      }),
    );
    return {
      items: result.items.map(UserSerializer.one),
      page,
      limit: parsed.limit,
      total: result.total,
    };
  }

  async getUser(publicId: string): Promise<UserOutput> {
    const user = await this.repository.findByPublicId(publicId);
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  async adminUpdateUser(publicId: string, body: unknown): Promise<UserOutput> {
    const parsed = validateAdminUpdateUser(body);
    const user = await this.repository.adminUpdate(publicId, omitUndefined(parsed));
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  async deleteUser(publicId: string): Promise<void> {
    await this.softDeleteUserWithOffboarding(publicId);
  }

  async suspendUser(publicId: string): Promise<UserOutput> {
    const user = await this.repository.suspend(publicId);
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  async unsuspendUser(publicId: string): Promise<UserOutput> {
    const user = await this.repository.unsuspend(publicId);
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }
}
