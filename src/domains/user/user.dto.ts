import { z } from 'zod';
import { trimmedString } from '@/shared/utils/validation/validation.util.js';

// ── Self-service DTOs ────────────────────────────────────────

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
export type UpdateMeInput = z.infer<typeof UpdateMeDto>;

export const UploadAvatarDto = z
  .object({
    avatarKey: trimmedString()
      .max(512)
      .refine((key) => key.startsWith('avatars/'), {
        message: 'Avatar key must start with "avatars/"',
      }),
  })
  .strict();
export type UploadAvatarInput = z.infer<typeof UploadAvatarDto>;

// ── Admin DTOs ───────────────────────────────────────────────

export const ListUsersDto = z
  .object({
    after: z.string().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
    search: trimmedString().max(255).optional(),
    // Opt in to the expensive count(*); defaults to false so the admin list stays keyset-only.
    // String enum (no transform) so the schema renders to JSON Schema for OpenAPI; service
    // coerces it to a boolean.
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();
export type ListUsersInput = z.infer<typeof ListUsersDto>;

export const AdminUpdateUserDto = z
  .object({
    first_name: trimmedString().max(100).nullable().optional(),
    last_name: trimmedString().max(100).nullable().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  })
  .strict();
export type AdminUpdateUserInput = z.infer<typeof AdminUpdateUserDto>;
