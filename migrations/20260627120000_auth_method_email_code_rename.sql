-- Rename the passwordless email auth-method value MAGIC_LINK -> EMAIL_CODE.
-- The product replaced "magic link" with an emailed verification code (POST /auth/email/send-code +
-- POST /auth/email/login). The allowed-string CHECK on auth.auth_methods.method_type and any existing
-- auth.verification_tokens.token_type rows are migrated in place (no native enum; still an allowed string).

ALTER TABLE auth.auth_methods DROP CONSTRAINT IF EXISTS chk_auth_methods_type;
--> statement-breakpoint

UPDATE auth.auth_methods SET method_type = 'EMAIL_CODE' WHERE method_type = 'MAGIC_LINK';
--> statement-breakpoint

ALTER TABLE auth.auth_methods ADD CONSTRAINT chk_auth_methods_type CHECK (
  method_type IN ('PASSWORD', 'EMAIL_CODE', 'OAUTH', 'MFA_TOTP', 'MFA_SMS', 'MFA_EMAIL')
) NOT VALID;
--> statement-breakpoint

ALTER TABLE auth.auth_methods VALIDATE CONSTRAINT chk_auth_methods_type;
--> statement-breakpoint

UPDATE auth.verification_tokens SET token_type = 'EMAIL_CODE' WHERE token_type = 'MAGIC_LINK';
