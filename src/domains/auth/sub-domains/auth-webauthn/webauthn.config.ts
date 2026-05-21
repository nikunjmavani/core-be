import { env } from '@/shared/config/env.config.js';

export function resolveWebauthnRelyingPartyId(): string {
  if (env.WEBAUTHN_RP_ID && env.WEBAUTHN_RP_ID.length > 0) {
    return env.WEBAUTHN_RP_ID;
  }
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()) ?? [];
  for (const origin of allowedOrigins) {
    try {
      const hostname = new URL(origin).hostname;
      if (hostname.length > 0) {
        return hostname;
      }
    } catch {
      // ignore invalid entries
    }
  }
  return 'localhost';
}

export function resolveWebauthnRelyingPartyName(): string {
  return env.WEBAUTHN_RP_NAME && env.WEBAUTHN_RP_NAME.length > 0 ? env.WEBAUTHN_RP_NAME : 'core-be';
}

export function resolveWebauthnExpectedOrigin(requestOrigin?: string): string {
  if (requestOrigin && requestOrigin.length > 0) {
    return requestOrigin;
  }
  const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()) ?? [];
  const firstOrigin = allowedOrigins[0];
  if (firstOrigin && firstOrigin.length > 0) {
    return firstOrigin;
  }
  const relyingPartyId = resolveWebauthnRelyingPartyId();
  return relyingPartyId === 'localhost' ? 'http://localhost:3000' : `https://${relyingPartyId}`;
}
