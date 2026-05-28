/** Global (cross-organization) role codes; checked by `requireRole` and seed data. */
export const GLOBAL_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  USER: 'user',
} as const;

/** String-literal union of every value in {@link GLOBAL_ROLES}. */
export type GlobalRole = (typeof GLOBAL_ROLES)[keyof typeof GLOBAL_ROLES];
