import type { UserOutput } from './user.types.js';

export const UserSerializer = {
  one(row: {
    public_id: string;
    email: string;
    is_email_verified: boolean;
    is_mfa_enabled: boolean;
    first_name: string | null;
    last_name: string | null;
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
      avatar_url: row.avatar_url,
      status: row.status,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  },
};
