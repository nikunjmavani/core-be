# Field secrets management

Application-level encryption for short secrets at rest (MFA TOTP seeds, webhook signing keys).

## Key material

- Set `SECRETS_ENCRYPTION_KEY` to **64 hex characters** (32 bytes). Generate with:

```bash
openssl rand -hex 32
```

- **Required in production.** Boot fails when `NODE_ENV=production` and the key is missing.
- Do not derive this key from `JWT_SECRET` or `RESPONSE_ENCRYPTION_KEY`.

## Rotation

1. Generate a new key (`NEW_KEY`).
2. During a maintenance window, run:

```bash
SECRETS_ENCRYPTION_KEY="$NEW_KEY" \
ROTATE_FROM_SECRETS_KEY="$OLD_KEY" \
pnpm tool:rotate-field-secrets --dry-run

SECRETS_ENCRYPTION_KEY="$NEW_KEY" \
ROTATE_FROM_SECRETS_KEY="$OLD_KEY" \
pnpm tool:rotate-field-secrets
```

3. Update the deployment secret (`SECRETS_ENCRYPTION_KEY`) and restart API + worker processes.

The script re-encrypts rows in `auth.mfa_methods.encrypted_secret` and `notify.webhooks.encrypted_secret`.

## Envelope format

Values are stored as `v1:` + base64(AES-256-GCM with random IV and auth tag). Legacy plaintext values are still readable until rotated.

## Related

- [`src/shared/utils/security/field-secret-encryption.util.ts`](../../../src/shared/utils/security/field-secret-encryption.util.ts)
- [`docs/deployment/runbooks/jwt-key-rotation.md`](../../deployment/runbooks/jwt-key-rotation.md) (JWT signing keys — separate from field secrets)
