import type { UserOutput } from './user.types.js';

/**
 * Project a `users` row into the public {@link UserOutput} shape: surfaces the `public_id` as `id`,
 * emits timestamps as ISO-8601, and intentionally drops credential / lockout fields.
 */
export const UserSerializer = {
  one(row: {
    public_id: string;
    email: string;
    is_email_verified: boolean;
    is_mfa_enabled: boolean;
    first_name: string | null;
    last_name: string | null;
    job_title: string | null;
    avatar_url: string | null;
    status: string;
    created_at: Date;
    updated_at: Date;
  }): UserOutput {
    return {
      id: row.public_id,
      email: row.email,
      is_email_verified: row.is_email_verified,
      is_mfa_enabled: row.is_mfa_enabled,
      first_name: row.first_name,
      last_name: row.last_name,
      job_title: row.job_title,
      avatar_url: row.avatar_url,
      status: row.status,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  },
};
