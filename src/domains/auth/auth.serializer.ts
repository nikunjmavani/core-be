/** Subset of an `auth_methods` row that is safe to return to the owning user. */
interface AuthMethodResponseInput {
  id: number;
  method_type: string;
  provider: string | null;
  is_primary: boolean;
  verified_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
}

/**
 * Allowlist an auth-method row for the API response. NEVER emits credential material
 * (`encrypted_secret` — the AES-GCM TOTP seed), PII (`phone_number`, `provider_user_id`) or
 * internal sequential ids (`user_id`, `created_by_user_id`). `id` is retained because it is the
 * `DELETE /me/auth-methods/:id` path parameter (this table has no public id).
 */
function serializeAuthMethod(item: AuthMethodResponseInput) {
  return {
    id: item.id,
    method_type: item.method_type,
    provider: item.provider,
    is_primary: item.is_primary,
    verified_at: item.verified_at,
    last_used_at: item.last_used_at,
    created_at: item.created_at,
  };
}

/** Function-based serializers that shape HTTP response bodies for the auth domain (access token, MFA challenge, magic-link confirmation, etc.). */
export const AuthSerializer = {
  accessToken(data: { access_token: string; session_public_id?: string }) {
    return {
      access_token: data.access_token,
      ...(data.session_public_id !== undefined
        ? { session_public_id: data.session_public_id }
        : {}),
    };
  },
  mfaRequired(data: { mfa_required: true; mfa_session_token: string }) {
    return data;
  },
  magicLinkSent(data: { message: string; expires_in_minutes: number }) {
    return {
      message: data.message,
      expires_in_minutes: data.expires_in_minutes,
    };
  },
  mfaVerified(data: { verified: boolean }) {
    return data;
  },
  authMethodList(items: AuthMethodResponseInput[]) {
    return items.map(serializeAuthMethod);
  },
  authMethod(item: AuthMethodResponseInput) {
    return serializeAuthMethod(item);
  },
  message(data: { message: string }) {
    return data;
  },
  mfaEnroll(data: { secret: string; provisioning_uri: string; method_id: number }) {
    return data;
  },
  oauthProviders(data: { providers: string[] }) {
    return data;
  },
};
