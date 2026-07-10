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
  job_title: string | null;
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
  job_title: string | null;
  avatar_url: string | null;
  status: string;
  /**
   * Whether the caller has finished the onboarding wizard. Drives the frontend's
   * post-login routing: `false` sends every fresh user (personal or team) through
   * onboarding once; `true` goes straight to the dashboard.
   */
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Deployment organization capabilities (from the env flags), surfaced on `/users/me` so the
   * frontend can hide the disabled organization kind. Present only on the self projection;
   * omitted from admin user listings.
   */
  capabilities?: OrganizationCapabilities;
  /**
   * The caller's personal organization id (`org_…`) — the "Personal" entry in the workspace
   * switcher. Null when personal organizations are disabled (team-only deployment). Self
   * projection only.
   */
  personal_organization_id?: string | null;
}

/** Which organization kinds this deployment enables — mirrors the env capability flags. */
export interface OrganizationCapabilities {
  /** A user has at most one personal organization, so this flag is singular. */
  personal_organization: boolean;
  team_organizations: boolean;
}
