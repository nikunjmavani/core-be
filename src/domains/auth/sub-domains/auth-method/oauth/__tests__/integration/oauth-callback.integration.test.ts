import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectUnauthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import type { OAuthProfile } from '@/domains/auth/sub-domains/auth-method/oauth/oauth.types.js';
import type { FastifyInstance } from 'fastify';

/**
 * `GET /auth/oauth/:provider/callback` exchanges a provider authorization code for a session —
 * the single most security-sensitive path in the auth domain — and it had **no HTTP case
 * anywhere**. Its constituent logic is well covered (`oauth-state.unit.test.ts`,
 * `oauth-user-session.unit.test.ts`, `oauth-pkce.unit.test.ts`, both provider adapters), so this
 * is the classic seam: every part works and nothing proved they are connected.
 *
 * Only the outbound network call to Google is stubbed. The CSRF `state`, the PKCE verifier, the
 * browser-binding nonce cookie, the find-or-create user write, and the session mint all run for
 * real, driven through the authorize route that a browser would actually hit first.
 */

const exchangeGoogleOAuthCodeMock = vi.fn<() => Promise<OAuthProfile>>();

vi.mock(
  '@/domains/auth/sub-domains/auth-method/oauth/providers/google-oauth.provider.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/domains/auth/sub-domains/auth-method/oauth/providers/google-oauth.provider.js')
      >();
    return {
      ...actual,
      // Only the token/userinfo round-trip is stubbed; buildGoogleOAuthRedirectUrl stays real so
      // the `state` under test is the one the authorize route actually minted.
      exchangeGoogleOAuthCode: () => exchangeGoogleOAuthCodeMock(),
    };
  },
);

const OAUTH_NONCE_COOKIE = 'oauth_nonce';

describe('GET /api/v1/auth/oauth/:provider/callback — Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    exchangeGoogleOAuthCodeMock.mockReset();
    exchangeGoogleOAuthCodeMock.mockResolvedValue({
      email: 'oauth-callback@example.com',
      name: 'OAuth Callback',
      provider_user_id: 'google-user-1',
    });
  });

  /** Drives the real authorize route and returns the minted `state` plus the browser nonce cookie. */
  async function beginAuthorizeFlow(): Promise<{ state: string; nonce: string }> {
    const redirect = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/oauth/google'),
    });
    expect(redirect.statusCode, redirect.body).toBe(200);
    const { redirect_url: redirectUrl } = (redirect.json() as { data: { redirect_url: string } })
      .data;
    const state = new URL(redirectUrl).searchParams.get('state');
    expect(state).toBeTruthy();
    const nonce = redirect.cookies[OAUTH_NONCE_COOKIE];
    // The nonce cookie is what binds the callback to this browser; without it the flow below
    // would be testing a weaker path than the one a real client takes.
    expect(nonce).toBeTruthy();
    return { state: state as string, nonce: nonce as string };
  }

  it('exchanges a valid state + code for the declared 200 and mints a session', async () => {
    const { state, nonce } = await beginAuthorizeFlow();

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath(`/auth/oauth/google/callback?code=provider-code&state=${state}`),
      cookies: { [OAUTH_NONCE_COOKIE]: nonce },
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { data: { access_token?: string } };
    expect(body.data.access_token).toBeTypeOf('string');
    // The session cookie is the proof the route is wired to the session-minting half of the
    // service, not just to the state consumption.
    expect(response.cookies.session_id).toBeTruthy();
    expect(exchangeGoogleOAuthCodeMock).toHaveBeenCalledOnce();

    // The nonce is single-use: the callback clears it so a replayed state cannot reuse it.
    const setCookieHeader = response.headers['set-cookie'];
    const setCookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ''];
    expect(setCookies.some((cookie) => cookie.startsWith(`${OAUTH_NONCE_COOKIE}=`))).toBe(true);
  });

  it('refuses a mismatched state and never reaches the provider', async () => {
    const { nonce } = await beginAuthorizeFlow();

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath('/auth/oauth/google/callback?code=provider-code&state=forged-state-value'),
      cookies: { [OAUTH_NONCE_COOKIE]: nonce },
    });

    // A forged/replayed state is the login-CSRF primitive; the route must refuse before the
    // code is ever exchanged, and must not mint a session.
    expect(response.statusCode, response.body).toBe(401);
    expect(exchangeGoogleOAuthCodeMock).not.toHaveBeenCalled();
    expect(response.cookies.session_id).toBeUndefined();
  });

  it('rejects a callback with no authorization code as a 400', async () => {
    const { state, nonce } = await beginAuthorizeFlow();

    const response = await injectUnauthenticated(app, {
      method: 'GET',
      url: testApiPath(`/auth/oauth/google/callback?state=${state}`),
      cookies: { [OAUTH_NONCE_COOKIE]: nonce },
    });

    // The querystring schema is the first gate — a missing code must not reach the service.
    expect(response.statusCode, response.body).toBe(400);
    expect(exchangeGoogleOAuthCodeMock).not.toHaveBeenCalled();
  });
});
