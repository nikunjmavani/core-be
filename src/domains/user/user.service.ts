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
import { withGlobalAdminDatabaseContext } from '@/infrastructure/database/contexts/global-admin-database.context.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { runInsertWithPublicIdentifierRetry } from '@/shared/utils/infrastructure/postgres-error.util.js';

const ALLOWED_AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Cross-domain services injected lazily into {@link UserService} so account deletion can fan out
 * its side effects.
 *
 * @remarks
 * - **Algorithm:** wired post-construction by `wireOffboardingServices` so the user container can
 *   be built before the auth, upload, and data-export containers exist (breaks circular DI).
 * - **Failure modes:** if any dependency is missing at deletion time, the service falls back to a
 *   plain soft-delete and emits no fan-out (see {@link UserService} `softDeleteUserWithOffboarding`).
 * - **Side effects:** none directly — the hosted services are responsible for queue / DB / S3 effects.
 * - **Notes:** intentionally typed as a record rather than an interface so the optional wiring path
 *   stays explicit at the call site.
 */
export type UserOffboardingDependencies = {
  authSessionService: AuthSessionService;
  authMethodService: AuthMethodService;
  uploadService: UploadService;
  userDataExportService: UserDataExportService;
};

/**
 * Owns the canonical `users` row and the self-service / admin flows that read or mutate it.
 *
 * @remarks
 * - **Algorithm:** profile reads/writes go through {@link UserRepository}; admin list builds
 *   keyset pagination over `(created_at, id)`; avatar upload validates the S3 key against the
 *   user's owned namespace, calls `headObject` for content-type sanity, and asserts the upload
 *   row is `confirmed` inside the user-database context. Suspending a user (or any admin status
 *   change away from `ACTIVE`) revokes all of that user's sessions so an outstanding token cannot
 *   survive the deactivation. Account deletion runs
 *   `softDeleteUserWithOffboarding`: revoke all auth sessions, revoke all auth methods, then
 *   inside `withTransaction` tombstone uploads + purge data-export rows + soft-delete the user.
 * - **Failure modes:** missing user → {@link NotFoundError}; avatar key outside owner namespace
 *   or content type not in `ALLOWED_AVATAR_CONTENT_TYPES` → {@link ValidationError}; missing
 *   wired dependencies → fall back to plain soft-delete and warn-log; S3 delete failures during
 *   offboarding are warn-logged but do not abort the transaction.
 * - **Side effects:** writes `auth.users`; deletes S3 avatar objects; revokes sessions /
 *   credentials via auth services; tombstones uploads; purges data-export rows + S3 objects.
 *   No domain events emitted (offboarding is synchronous; export completion uses direct mail).
 * - **Notes:** password / MFA / email-verification updates run inside `withUserDatabaseContext`
 *   so RLS policies on user-scoped child tables continue to work; `wireOffboardingServices` is
 *   the only seam for cross-domain dependencies — keep them off the constructor to avoid
 *   circular DI between user, auth, upload, and user-data-export.
 */
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
    await withUserDatabaseContext(public_id, () =>
      this.repository.update(public_id, { avatar_url: null }),
    );
  }

  private async softDeleteUserWithOffboarding(public_id: string): Promise<void> {
    // Offboarding can be initiated by the user (deleteMe) or an admin (deleteUser); both know the
    // TARGET public_id, so pin the target user context — the owner WITH CHECK then authorizes the
    // FORCE RLS soft-delete without entering the broader global-admin context from the self path.
    const user = await this.requireUserRecordByPublicId(public_id).catch(() => null);
    if (!user) throw new NotFoundError('User');
    if (!this.offboardingDependencies) {
      const deleted = await withUserDatabaseContext(public_id, () =>
        this.repository.softDelete(public_id),
      );
      if (!deleted) throw new NotFoundError('User');
      return;
    }
    await this.clearAvatarStorage(public_id, user.avatar_url);
    await this.offboardingDependencies.authSessionService.revokeAllSessions(public_id);
    await this.offboardingDependencies.authMethodService.revokeAllForUser(public_id);
    await withTransaction(async () => {
      await this.offboardingDependencies!.uploadService.tombstoneAllByUserId(user.id);
      await this.offboardingDependencies!.userDataExportService.deleteAllExportsForUser(
        user.id,
        public_id,
      );
      const deleted = await withUserDatabaseContext(public_id, () =>
        this.repository.softDelete(public_id),
      );
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
    // auth.users is FORCE RLS (audit #7); a by-public-id lookup pins the matching owner context so
    // the owner policy returns exactly that one row (it can never enumerate the table). Works for
    // self reads and single-target admin/system lookups alike.
    return withUserDatabaseContext(public_id, () => this.repository.findByPublicId(public_id));
  }

  async requireUserRecordByPublicId(public_id: string): Promise<UserAuthRecord> {
    const user = await withUserDatabaseContext(public_id, () =>
      this.repository.findByPublicId(public_id),
    );
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
    // FORCE RLS owner WITH CHECK requires public_id = app.current_user_id. Generate the id first,
    // enter that user's context, then insert with the exact id so the policy passes. The retry
    // regenerates id + re-enters context on the (rare) public_id unique collision.
    return runInsertWithPublicIdentifierRetry(async () => {
      const publicId = generatePublicId();
      return withUserDatabaseContext(publicId, () =>
        this.repository.insertOAuthUser(publicId, data),
      );
    });
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
    // Login is pre-session, but the TARGET public_id is known after the email resolver, so pin the
    // owner context — the owner WITH CHECK authorizes the lockout-counter write under FORCE RLS.
    return withUserDatabaseContext(public_id, () =>
      this.repository.updateLoginAttempt(public_id, failed_login_count, account_locked_until),
    );
  }

  async updateMfaEnabled(public_id: string, enabled: boolean): Promise<UserAuthRecord | null> {
    return withUserDatabaseContext(public_id, () =>
      this.repository.updateMfaEnabled(public_id, enabled),
    );
  }

  async updateEmailVerified(public_id: string): Promise<UserAuthRecord | null> {
    // Email-verify consumes a token pre-session; the TARGET public_id is known, so pin the owner
    // context so the owner WITH CHECK authorizes the verified-flag write under FORCE RLS.
    return withUserDatabaseContext(public_id, () => this.repository.updateEmailVerified(public_id));
  }

  async resolveInternalIdByPublicId(public_id: string): Promise<number | null> {
    const user = await withUserDatabaseContext(public_id, () =>
      this.repository.findByPublicId(public_id),
    );
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
    const user = await withUserDatabaseContext(publicId, () =>
      this.repository.findByPublicId(publicId),
    );
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
    const user = await withUserDatabaseContext(publicId, () =>
      this.repository.update(
        publicId,
        omitUndefined({
          ...profileFields,
          ...(avatarUrl !== undefined ? { avatar_url: avatarUrl } : {}),
        }),
      ),
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
    const user = await withUserDatabaseContext(publicId, () =>
      this.repository.update(publicId, { avatar_url: avatarKey }),
    );
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  async deleteAvatar(publicId: string): Promise<UserOutput> {
    const user = await withUserDatabaseContext(publicId, () =>
      this.repository.update(publicId, { avatar_url: null }),
    );
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  // ── Admin operations ────────────────────────────────────────

  async listUsers(query: unknown) {
    const parsed = validateListUsers(query);
    // Admin cross-user listing must read every row → global-admin context (route is guarded by
    // requireRole(SUPER_ADMIN, ADMIN), so entering the admin RLS escape hatch is authorized).
    const result = await withGlobalAdminDatabaseContext(() =>
      this.repository.findMany(
        omitUndefined({
          after: parsed.after,
          limit: parsed.limit,
          status: parsed.status,
          search: parsed.search,
          include_total: parsed.include_total === 'true',
        }),
      ),
    );
    return {
      items: result.items.map(UserSerializer.one),
      limit: result.limit,
      total: result.total,
      has_more: result.has_more,
      next_cursor: result.next_cursor,
    };
  }

  async getUser(publicId: string): Promise<UserOutput> {
    // Admin read of another user → global-admin context (route guarded by requireRole).
    const user = await withGlobalAdminDatabaseContext(() =>
      this.repository.findByPublicId(publicId),
    );
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }

  async adminUpdateUser(publicId: string, body: unknown): Promise<UserOutput> {
    const parsed = validateAdminUpdateUser(body);
    const user = await withGlobalAdminDatabaseContext(() =>
      this.repository.adminUpdate(publicId, omitUndefined(parsed)),
    );
    if (!user) throw new NotFoundError('User');
    if (parsed.status !== undefined && parsed.status !== 'ACTIVE') {
      await this.revokeAllSessionsForDeactivatedUser(publicId);
    }
    return UserSerializer.one(user);
  }

  async deleteUser(publicId: string): Promise<void> {
    await this.softDeleteUserWithOffboarding(publicId);
  }

  async suspendUser(publicId: string): Promise<UserOutput> {
    const user = await withGlobalAdminDatabaseContext(() => this.repository.suspend(publicId));
    if (!user) throw new NotFoundError('User');
    await this.revokeAllSessionsForDeactivatedUser(publicId);
    return UserSerializer.one(user);
  }

  /**
   * Revokes every active session for a user that just transitioned out of `ACTIVE`
   * (suspend or admin status change) so an outstanding bearer/cookie session cannot
   * outlive the deactivation. Session-validity cache invalidation is handled by
   * {@link AuthSessionService.revokeAllSessions}. No-ops when the auth-session
   * dependency has not been wired (e.g. minimal containers / unit tests).
   */
  private async revokeAllSessionsForDeactivatedUser(publicId: string): Promise<void> {
    if (!this.authSessionService) return;
    await this.authSessionService.revokeAllSessions(publicId);
  }

  async unsuspendUser(publicId: string): Promise<UserOutput> {
    const user = await withGlobalAdminDatabaseContext(() => this.repository.unsuspend(publicId));
    if (!user) throw new NotFoundError('User');
    return UserSerializer.one(user);
  }
}
