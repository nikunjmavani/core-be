import type { users } from './user.schema.js';

export type UserAuthRecord = typeof users.$inferSelect;

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
