/**
 * Canonical `auth.auth_methods.method_type` values — the single source of truth
 * shared by the Drizzle schema CHECK constraint, validators, and every insert
 * site so casing can never drift from the database constraint
 * (`chk_auth_methods_type`).
 *
 * @remarks
 * - **Algorithm:** the object literal is the authority; {@link AUTH_METHOD_TYPES}
 *   derives the allowed-value list used by the schema CHECK so adding a method
 *   type only requires one edit here.
 * - **Failure modes:** inserting a `method_type` outside these values violates
 *   the database CHECK constraint and raises a Postgres error — always reference
 *   {@link AUTH_METHOD_TYPE} rather than a string literal at insert sites.
 * - **Side effects:** none — compile-time constants only.
 * - **Notes:** values are intentionally UPPERCASE to match the persisted column
 *   contract; `EMAIL_CODE` here is the auth-method credential type (passwordless email
 *   verification-code login), distinct from the `verification_tokens.token_type` of the same name.
 */
export const AUTH_METHOD_TYPE = {
  PASSWORD: 'PASSWORD',
  EMAIL_CODE: 'EMAIL_CODE',
  OAUTH: 'OAUTH',
  MFA_TOTP: 'MFA_TOTP',
  MFA_SMS: 'MFA_SMS',
  MFA_EMAIL: 'MFA_EMAIL',
} as const;

/** Literal union of supported {@link AUTH_METHOD_TYPE} values. */
export type AuthMethodType = (typeof AUTH_METHOD_TYPE)[keyof typeof AUTH_METHOD_TYPE];

/** All allowed `method_type` values, used to derive the schema CHECK constraint. */
export const AUTH_METHOD_TYPES = Object.values(AUTH_METHOD_TYPE) as AuthMethodType[];
