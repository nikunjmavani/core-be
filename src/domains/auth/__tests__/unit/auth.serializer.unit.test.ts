/** Bundled auth serializer tests — AuthSerializer lives at domain root; sub-domain serializers N/A. */
import { describe, expect, it } from 'vitest';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';

describe('AuthSerializer', () => {
  it('accessToken wraps access_token', () => {
    expect(AuthSerializer.accessToken({ access_token: 'token-abc' })).toEqual({
      access_token: 'token-abc',
    });
  });

  it('magicLinkSent shapes response with message and expiry (token never returned)', () => {
    const payload = { message: 'sent', expires_in_minutes: 15 };
    expect(AuthSerializer.magicLinkSent(payload)).toStrictEqual({
      message: 'sent',
      expires_in_minutes: 15,
    });
    /**
     * Defense-in-depth: even if a `token` slips through the typed boundary,
     * the serializer must not forward it. Verifies the leak removal.
     */
    const stray = AuthSerializer.magicLinkSent({
      message: 'sent',
      expires_in_minutes: 15,
      ...({ token: 'should-not-leak' } as Record<string, unknown>),
    });
    expect(stray).not.toHaveProperty('token');
  });

  it('mfaVerified returns verified flag', () => {
    expect(AuthSerializer.mfaVerified({ verified: true })).toEqual({ verified: true });
  });

  it('authMethodList and authMethod allowlist safe fields and strip secrets/PII/internal ids', () => {
    const row = {
      id: 7,
      user_id: 42,
      method_type: 'MFA_TOTP',
      provider: null,
      provider_user_id: 'google-sub-12345',
      encrypted_secret: 'aes-gcm-ciphertext-of-totp-seed',
      phone_number: '+15551234567',
      is_primary: true,
      verified_at: new Date('2026-01-01T00:00:00.000Z'),
      last_used_at: null,
      created_at: new Date('2026-01-02T00:00:00.000Z'),
      revoked_at: null,
      created_by_user_id: 42,
    };

    const expected = {
      id: 7,
      method_type: 'MFA_TOTP',
      provider: null,
      is_primary: true,
      verified_at: new Date('2026-01-01T00:00:00.000Z'),
      last_used_at: null,
      created_at: new Date('2026-01-02T00:00:00.000Z'),
    };

    const [serialized] = AuthSerializer.authMethodList([row]);
    expect(serialized).toEqual(expected);
    expect(AuthSerializer.authMethod(row)).toEqual(expected);

    // Defense-in-depth: no credential material, PII, or internal ids may ever appear.
    for (const result of [serialized, AuthSerializer.authMethod(row)]) {
      expect(result).not.toHaveProperty('encrypted_secret');
      expect(result).not.toHaveProperty('phone_number');
      expect(result).not.toHaveProperty('provider_user_id');
      expect(result).not.toHaveProperty('user_id');
      expect(result).not.toHaveProperty('created_by_user_id');
      expect(JSON.stringify(result)).not.toContain('aes-gcm-ciphertext-of-totp-seed');
      expect(JSON.stringify(result)).not.toContain('+15551234567');
    }
  });

  it('message returns payload unchanged', () => {
    const payload = { message: 'Password reset email sent' };
    expect(AuthSerializer.message(payload)).toBe(payload);
  });

  it('mfaEnroll and oauthProviders return structured data', () => {
    expect(
      AuthSerializer.mfaEnroll({
        secret: 'secret',
        provisioning_uri: 'otpauth://',
        method_id: 1,
      }),
    ).toMatchObject({ secret: 'secret', method_id: 1 });

    expect(AuthSerializer.oauthProviders({ providers: ['google'] })).toEqual({
      providers: ['google'],
    });
  });
});
