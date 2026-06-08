import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

// ── Self-service DTOs ────────────────────────────────────────

/**
 * Zod schema for the `PATCH /api/v1/users/me` request body. The optional `avatarKey` is the S3
 * object key returned from a confirmed upload — it must live under the `avatars/` prefix and is
 * verified by the service against the user's owned key namespace before being persisted.
 */
export const UpdateMeDto = z
  .object({
    first_name: trimmedString().max(100).nullable().optional(),
    last_name: trimmedString().max(100).nullable().optional(),
    avatarKey: trimmedString()
      .max(512)
      .refine((key) => key.startsWith('avatars/'), {
        message: 'Avatar key must start with "avatars/"',
      })
      .optional(),
  })
  .strict();
/** Inferred body type from {@link UpdateMeDto}. */
export type UpdateMeInput = z.infer<typeof UpdateMeDto>;

/**
 * Zod schema for the `PUT /api/v1/users/me/avatar` request body. Requires an `avatars/`-prefixed
 * S3 key produced by the upload confirmation flow.
 */
export const UploadAvatarDto = z
  .object({
    avatarKey: trimmedString()
      .max(512)
      .refine((key) => key.startsWith('avatars/'), {
        message: 'Avatar key must start with "avatars/"',
      }),
  })
  .strict();
/** Inferred body type from {@link UploadAvatarDto}. */
export type UploadAvatarInput = z.infer<typeof UploadAvatarDto>;

// ── Admin DTOs ───────────────────────────────────────────────

/**
 * Zod schema for the `GET /api/v1/users` admin query string. Cursor-only pagination via `after`;
 * `include_total` is an opt-in (string enum so it round-trips through OpenAPI cleanly) that turns
 * on the otherwise-omitted `count(*)`.
 */
export const ListUsersDto = z
  .object({
    // sec-new-U1: cap cursor length so an unbounded string cannot reach the service layer.
    after: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
    search: trimmedString().max(255).optional(),
    // Opt in to the expensive count(*); defaults to false so the admin list stays keyset-only.
    // String enum (no transform) so the schema renders to JSON Schema for OpenAPI; service
    // coerces it to a boolean.
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();
/** Inferred query type from {@link ListUsersDto}. */
export type ListUsersInput = z.infer<typeof ListUsersDto>;

/**
 * Zod schema for the `PATCH /api/v1/users/:userId` admin body. Status only allows `ACTIVE` /
 * `SUSPENDED` here — `DELETED` is reachable only through the dedicated delete endpoint, which
 * triggers full soft-delete + offboarding.
 */
export const AdminUpdateUserDto = z
  .object({
    first_name: trimmedString().max(100).nullable().optional(),
    last_name: trimmedString().max(100).nullable().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict();
/** Inferred body type from {@link AdminUpdateUserDto}. */
export type AdminUpdateUserInput = z.infer<typeof AdminUpdateUserDto>;
