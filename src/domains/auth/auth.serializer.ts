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
  magicLinkSent(data: { message: string; expires_in_minutes: number; token?: string }) {
    return {
      message: data.message,
      expires_in_minutes: data.expires_in_minutes,
      ...(data.token !== undefined ? { token: data.token } : {}),
    };
  },
  mfaVerified(data: { verified: boolean }) {
    return data;
  },
  authMethodList<T>(items: T[]): T[] {
    return items;
  },
  authMethod<T>(item: T): T {
    return item;
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
