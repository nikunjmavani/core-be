import type { users } from './user.schema.js';

/**
 * Drizzle-inferred select row from `auth.users` — the canonical record used by auth, billing,
 * and offboarding flows (includes `password_hash`, lockout fields, and `deleted_at`).
 */
export type UserAuthRecord = typeof users.$inferSelect;

/** Public user shape used inside the user domain (excludes credential fields from {@link UserAuthRecord}). */
export interface User {
  id: number;
  public_id: string;
  email: string;
  email_hash: string;
  is_email_verified: boolean;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/** API response shape for user endpoints; `id` is the public id and timestamps are ISO-8601 strings. */
export interface UserOutput {
  id: string;
  email: string;
  is_email_verified: boolean;
  is_mfa_enabled: boolean;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}
