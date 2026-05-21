/** Bundled auth serializer tests — AuthSerializer lives at domain root; sub-domain serializers N/A. */
import { describe, expect, it } from 'vitest';
import { AuthSerializer } from '@/domains/auth/auth.serializer.js';

describe('AuthSerializer', () => {
  it('accessToken wraps access_token', () => {
    expect(AuthSerializer.accessToken({ access_token: 'token-abc' })).toEqual({
      access_token: 'token-abc',
    });
  });

  it('magicLinkSent shapes response with message and expiry', () => {
    const payload = { message: 'sent', expires_in_minutes: 15, token: 't' };
    expect(AuthSerializer.magicLinkSent(payload)).toStrictEqual({
      message: 'sent',
      expires_in_minutes: 15,
      token: 't',
    });
  });

  it('mfaVerified returns verified flag', () => {
    expect(AuthSerializer.mfaVerified({ verified: true })).toEqual({ verified: true });
  });

  it('authMethodList and authMethod are pass-through', () => {
    const items = [{ id: '1' }];
    expect(AuthSerializer.authMethodList(items)).toBe(items);
    expect(AuthSerializer.authMethod(items[0]!)).toEqual({ id: '1' });
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
