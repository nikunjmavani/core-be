import type { WebauthnCredentialRow } from './webauthn-credential.repository.js';

/**
 * Allowlist a registered passkey row for the owner-facing API response.
 *
 * @remarks
 * - **Algorithm:** projects only the fields safe to return to the owning user; the emitted `id`
 *   is the opaque `public_id` accepted by `DELETE /auth/me/webauthn/credentials/{credential_id}`.
 * - **Failure modes:** none — pure projection.
 * - **Side effects:** none.
 * - **Notes:** NEVER emits credential material (`public_key`), the raw WebAuthn `credential_id`
 *   blob, the signature `counter`, or internal ids (`id`, `user_id`). Revoked rows are excluded
 *   upstream by the repository, so `revoked_at` is not part of the contract.
 */
export function serializeWebauthnCredential(row: WebauthnCredentialRow) {
  return {
    id: row.public_id,
    device_type: row.device_type,
    backed_up: row.backed_up,
    transports: row.transports as string[],
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

/** Shapes a list of registered passkeys for the `GET /auth/me/webauthn/credentials` response. */
export function serializeWebauthnCredentialList(rows: WebauthnCredentialRow[]) {
  return rows.map(serializeWebauthnCredential);
}
