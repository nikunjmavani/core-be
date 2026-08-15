import { exchangeGitHubOAuthCode } from '@/domains/auth/sub-domains/auth-method/oauth/providers/github-oauth.provider.js';
import { env } from '@/shared/config/env.config.js';
import { UnauthorizedError } from '@/shared/errors/index.js';
import nock from 'nock';
import { describe, expect, test } from 'vitest';

import githubEmailsSuccessFixture from './fixtures/oauth/github.emails.success.response.json' with {
  type: 'json',
};
import githubTokenSuccessFixture from './fixtures/oauth/github.token.success.response.json' with {
  type: 'json',
};
import githubUserSuccessFixture from './fixtures/oauth/github.user.success.response.json' with {
  type: 'json',
};
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';
import {
  GitHubEmailsSuccessResponseContractSchema,
  GitHubTokenOutgoingJsonContractSchema,
  GitHubTokenSuccessResponseContractSchema,
  GitHubUserSuccessResponseContractSchema,
} from './schemas/oauth.schemas.js';

registerThirdPartyContractTestIsolationHooks();

const githubTokenHostnameOutbound = 'https://github.com';
const githubApiHostnameOutbound = 'https://api.github.com';

/**
 * GitHub's OAuth wire contract has two famous sharp edges this suite pins:
 *
 * 1. the token endpoint answers **HTTP 200 with an `error` field** for a bad or
 *    reused code (never a 4xx), so status-code handling alone can never catch it —
 *    the provider must read the body, and
 * 2. `GET /user` may return `"email": null` (private email), so account linking
 *    must come from `GET /user/emails` and accept only a primary AND verified
 *    address — the find-or-link takeover guard.
 */
describe('GitHub OAuth outbound contract (`github-oauth.provider`)', () => {
  test('token exchange posts JSON with Accept: application/json; user + emails carry the Bearer token', async () => {
    GitHubTokenSuccessResponseContractSchema.parse(githubTokenSuccessFixture);
    GitHubUserSuccessResponseContractSchema.parse(githubUserSuccessFixture);
    GitHubEmailsSuccessResponseContractSchema.parse(githubEmailsSuccessFixture);

    nock(githubTokenHostnameOutbound)
      .post('/login/oauth/access_token', (outboundJsonBody) => {
        const parsedOutgoingTokenRequest = GitHubTokenOutgoingJsonContractSchema.parse(
          typeof outboundJsonBody === 'string' ? JSON.parse(outboundJsonBody) : outboundJsonBody,
        );
        expect(parsedOutgoingTokenRequest.client_id).toBe(env.OAUTH_GITHUB_CLIENT_ID);
        expect(parsedOutgoingTokenRequest.client_secret).toBe(env.OAUTH_GITHUB_CLIENT_SECRET);
        expect(parsedOutgoingTokenRequest.code).toBe('contract-github-authorization-code');
        expect(parsedOutgoingTokenRequest.code_verifier).toBe('contract-github-pkce-verifier');
        return true;
      })
      // Without Accept: application/json GitHub answers form-encoded — the JSON
      // parse downstream depends on this header being pinned.
      .matchHeader('accept', 'application/json')
      .matchHeader('content-type', /application\/json/)
      .reply(200, githubTokenSuccessFixture);

    nock(githubApiHostnameOutbound)
      .get('/user')
      .matchHeader('authorization', `Bearer ${githubTokenSuccessFixture.access_token}`)
      .matchHeader('accept', 'application/vnd.github+json')
      .reply(200, githubUserSuccessFixture);

    nock(githubApiHostnameOutbound)
      .get('/user/emails')
      .matchHeader('authorization', `Bearer ${githubTokenSuccessFixture.access_token}`)
      .matchHeader('accept', 'application/vnd.github+json')
      .reply(200, githubEmailsSuccessFixture);

    const normalizedGitHubProfileOutbound = await exchangeGitHubOAuthCode({
      code: 'contract-github-authorization-code',
      codeVerifier: 'contract-github-pkce-verifier',
    });

    expect(normalizedGitHubProfileOutbound).toEqual({
      // The top-level `user.email` is null in the fixture on purpose: the email
      // MUST come from the primary+verified entry of /user/emails.
      email: 'contract.fixture@users.noreply.github.com',
      name: githubUserSuccessFixture.name,
      avatar_url: githubUserSuccessFixture.avatar_url,
      provider_user_id: String(githubUserSuccessFixture.id),
    });
  });

  test('token endpoint error-in-200 (bad_verification_code) is rejected as UnauthorizedError', async () => {
    nock(githubTokenHostnameOutbound).post('/login/oauth/access_token').reply(200, {
      error: 'bad_verification_code',
      error_description: 'The code passed is incorrect or expired.',
      error_uri:
        'https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/',
    });

    await expect(
      exchangeGitHubOAuthCode({
        code: 'contract-github-reused-code',
        codeVerifier: 'contract-github-pkce-verifier',
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  test('emails list without a primary+verified entry is rejected (find-or-link takeover guard)', async () => {
    nock(githubTokenHostnameOutbound)
      .post('/login/oauth/access_token')
      .reply(200, githubTokenSuccessFixture);
    nock(githubApiHostnameOutbound).get('/user').reply(200, githubUserSuccessFixture);
    nock(githubApiHostnameOutbound)
      .get('/user/emails')
      .reply(200, [{ email: 'unverified@example.com', primary: true, verified: false }]);

    await expect(
      exchangeGitHubOAuthCode({
        code: 'contract-github-authorization-code',
        codeVerifier: 'contract-github-pkce-verifier',
      }),
    ).rejects.toThrow(UnauthorizedError);
  });
});
