import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { captchaPreHandler } from '@/shared/middlewares/security/captcha.middleware.js';
import { requireRecentStepUpPreHandler } from '@/shared/middlewares/core/recent-step-up.middleware.js';
import {
  REFRESH_RATE_LIMIT,
  STRICT_AUTHED_RATE_LIMIT,
  STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS,
  STRICT_PUBLIC_RATE_LIMIT,
} from '@/shared/middlewares/rate-limit/rate-limit-presets.constants.js';
import { createAuthController } from './auth.controller.js';
import {
  authMethodIdParamsDto,
  ChangePasswordDto,
  CreateAuthMethodDto,
  ForgotPasswordDto,
  LoginDto,
  MagicLinkSendDto,
  MagicLinkVerifyDto,
  MfaEnrollDto,
  MfaLoginVerifyDto,
  MfaVerifyDto,
  mfaMethodIdParamsDto,
  OauthCallbackQueryDto,
  oauthProviderParamsDto,
  ResetPasswordDto,
  sessionIdParamsDto,
  StepUpVerifyDto,
  VerifyEmailDto,
} from './auth.dto.js';
import {
  webauthnAuthenticateOptionsDto,
  webauthnAuthenticateVerifyDto,
  webauthnRegisterVerifyDto,
} from './sub-domains/auth-webauthn/webauthn.dto.js';

/** Fastify plugin that registers all `/api/v1/auth/*` routes — login, logout, refresh, magic link, OAuth, password, email verification, MFA, WebAuthn, sessions, and auth-method management. */
export const authRoutesPlugin: FastifyPluginAsync = async (app) => {
  const controller = createAuthController(app.authDomain);
  const zodApplication = app.withTypeProvider<ZodTypeProvider>();

  // Per-identity (per-email) throttle layered on top of the IP-only STRICT_PUBLIC_RATE_LIMIT.
  // Applied to unauthenticated credential and outbound-email endpoints so abuse cannot bypass
  // the cap by rotating spoofed IPs (defense in depth alongside Turnstile CAPTCHA).
  const perEmailRateLimit = app.rateLimit(STRICT_PUBLIC_PER_EMAIL_RATE_LIMIT_OPTIONS);

  // Public — strict rate limits on login/magic-link/password endpoints
  zodApplication.post('/login', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [perEmailRateLimit, captchaPreHandler],
    schema: {
      summary: 'Login with email and password',
      description:
        'Authenticates a user with email and password credentials. Returns access and refresh tokens on success. If MFA is enabled, returns a challenge requiring a second factor.',
      tags: ['Auth'],
      body: LoginDto,
    },
    handler: controller.login,
  });
  zodApplication.post(
    '/logout',
    {
      ...STRICT_PUBLIC_RATE_LIMIT,
      schema: {
        summary: 'Logout current session',
        description:
          'Invalidates the current session and refresh token. Requires a valid bearer token.',
        tags: ['Auth'],
      },
    },
    controller.logout,
  );
  zodApplication.post('/magic-link/send', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [perEmailRateLimit, captchaPreHandler],
    schema: {
      summary: 'Send magic link email',
      description:
        'Sends a passwordless login link to the provided email address. The link expires after a short period.',
      tags: ['Auth', 'Magic Link'],
      body: MagicLinkSendDto,
    },
    handler: controller.sendMagicLink,
  });
  zodApplication.post('/magic-link/verify', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    schema: {
      summary: 'Verify magic link token',
      description:
        'Validates the magic link token and returns access and refresh tokens on success.',
      tags: ['Auth', 'Magic Link'],
      body: MagicLinkVerifyDto,
    },
    handler: controller.verifyMagicLink,
  });
  zodApplication.get(
    '/oauth/providers',
    {
      ...STRICT_PUBLIC_RATE_LIMIT,
      schema: {
        summary: 'List available OAuth providers',
        description:
          'Returns a list of configured OAuth providers (e.g. Google, GitHub) available for login.',
        tags: ['Auth', 'OAuth'],
      },
    },
    controller.listOauthProviders,
  );
  zodApplication.get('/oauth/:provider', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: {
      summary: 'Initiate OAuth flow',
      description:
        'Redirects the user to the OAuth provider authorization page to begin the login flow.',
      tags: ['Auth', 'OAuth'],
      params: oauthProviderParamsDto,
    },
    handler: controller.oauthRedirect,
  });
  zodApplication.get('/oauth/:provider/callback', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    schema: {
      summary: 'OAuth callback',
      description:
        'Handles the OAuth provider callback after user authorization. Exchanges the code for tokens and creates or links the user account.',
      tags: ['Auth', 'OAuth'],
      params: oauthProviderParamsDto,
      querystring: OauthCallbackQueryDto,
    },
    handler: controller.oauthCallback,
  });
  zodApplication.post('/password/forgot', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [perEmailRateLimit, captchaPreHandler],
    schema: {
      summary: 'Request password reset',
      description:
        'Sends a password reset email to the user. Returns 200 even if the email is not registered (to prevent enumeration).',
      tags: ['Auth', 'Password'],
      body: ForgotPasswordDto,
    },
    handler: controller.forgotPassword,
  });
  zodApplication.post('/password/reset', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: {
      summary: 'Reset password with token',
      description: 'Resets the user password using a valid reset token received via email.',
      tags: ['Auth', 'Password'],
      body: ResetPasswordDto,
    },
    handler: controller.resetPassword,
  });
  zodApplication.post('/email/verify', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: {
      summary: 'Verify email address',
      description:
        "Confirms the user's email address using a verification token sent during registration.",
      tags: ['Auth', 'Email Verification'],
      body: VerifyEmailDto,
    },
    handler: controller.verifyEmail,
  });
  zodApplication.post(
    '/mfa/login',
    {
      ...STRICT_PUBLIC_RATE_LIMIT,
      schema: {
        summary: 'Complete MFA during login',
        description:
          'Completes the login flow for an MFA-enabled account. Requires the short-lived mfa_session_token issued by POST /auth/login after password verification, plus a valid TOTP or recovery code. Returns access and refresh tokens and sets the session cookie on success.',
        tags: ['Auth', 'MFA'],
        body: MfaLoginVerifyDto,
      },
    },
    controller.verifyMfaLogin,
  );
  zodApplication.post('/webauthn/authenticate/options', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [perEmailRateLimit, captchaPreHandler],
    schema: { body: webauthnAuthenticateOptionsDto },
    handler: controller.webauthnAuthenticateOptions,
  });
  zodApplication.post('/webauthn/authenticate/verify', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    schema: { body: webauthnAuthenticateVerifyDto },
    handler: controller.webauthnAuthenticateVerify,
  });
  zodApplication.post(
    '/refresh',
    {
      ...REFRESH_RATE_LIMIT,
      schema: {
        summary: 'Refresh access token',
        description:
          'Exchanges a valid session cookie for a new short-lived access token. The session_id httpOnly cookie is sent automatically by the browser. When ALLOWED_ORIGINS is set, requests that include an Origin header must match that allowlist (403 otherwise); requests without Origin are allowed for non-browser clients.',
        tags: ['Auth', 'Token'],
      },
    },
    controller.refreshToken,
  );

  // Authenticated
  zodApplication.post(
    '/password/change',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRecentStepUpPreHandler],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Change current password',
        description:
          "Changes the authenticated user's password. Requires the current password for verification.",
        tags: ['Auth', 'Password'],
        body: ChangePasswordDto,
      },
    },
    controller.changePassword,
  );
  zodApplication.post(
    '/step-up',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Step-up (re-authenticate)',
        description:
          'Re-verifies the authenticated user\'s password to open a short "recent step-up" window required before sensitive credential mutations (MFA enrollment, passkey registration, auth-method changes). MFA users may instead complete an MFA verification. Returns 401 if the password is incorrect.',
        tags: ['Auth'],
        body: StepUpVerifyDto,
      },
    },
    controller.stepUp,
  );
  zodApplication.post(
    '/email/resend-verification',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Resend email verification',
        description: 'Resends the email verification link to the currently authenticated user.',
        tags: ['Auth', 'Email Verification'],
      },
    },
    controller.resendEmailVerification,
  );
  zodApplication.post(
    '/mfa/enroll',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRecentStepUpPreHandler],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Enroll in MFA',
        description:
          'Begins multi-factor authentication enrollment. Returns a TOTP secret and QR code URI for authenticator app setup.',
        tags: ['Auth', 'MFA'],
        body: MfaEnrollDto,
      },
    },
    controller.enrollMfa,
  );
  zodApplication.post(
    '/webauthn/register/options',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRecentStepUpPreHandler],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: {},
    },
    controller.webauthnRegisterOptions,
  );
  zodApplication.post(
    '/webauthn/register/verify',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRecentStepUpPreHandler],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: { body: webauthnRegisterVerifyDto },
    },
    controller.webauthnRegisterVerify,
  );
  zodApplication.get(
    '/mfa',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'List enrolled MFA methods',
        description: 'Returns all MFA methods enrolled by the authenticated user.',
        tags: ['Auth', 'MFA'],
      },
    },
    controller.listMfaMethods,
  );
  zodApplication.delete<{ Params: { mfaMethodId: string } }>(
    '/mfa/:mfaMethodId',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRecentStepUpPreHandler],
      schema: {
        summary: 'Remove MFA method',
        description:
          'Deletes an enrolled MFA method. Cannot remove the last MFA method if MFA is required by organization policy.',
        tags: ['Auth', 'MFA'],
        params: mfaMethodIdParamsDto,
      },
    },
    controller.deleteMfa,
  );
  zodApplication.delete(
    '/me/sessions',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Revoke all sessions',
        description:
          'Revokes all active sessions for the authenticated user except the current one.',
        tags: ['Auth', 'Session'],
      },
    },
    controller.revokeAllSessions,
  );
  zodApplication.post(
    '/mfa/verify',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: {
        summary: 'Verify MFA code',
        description:
          'Validates a TOTP code to complete MFA verification during login or enrollment confirmation.',
        tags: ['Auth', 'MFA'],
        body: MfaVerifyDto,
      },
    },
    controller.verifyMfa,
  );
  zodApplication.get(
    '/me/auth-methods',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'List my auth methods',
        description:
          'Returns all authentication methods (password, OAuth, magic link) linked to the authenticated user.',
        tags: ['Auth', 'Auth Method'],
      },
    },
    controller.listAuthMethods,
  );
  zodApplication.post(
    '/me/auth-methods',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRecentStepUpPreHandler],
      schema: {
        summary: 'Add auth method',
        description:
          "Links a new authentication method (e.g. OAuth provider) to the authenticated user's account.",
        tags: ['Auth', 'Auth Method'],
        body: CreateAuthMethodDto,
      },
    },
    controller.createAuthMethod,
  );
  zodApplication.delete<{ Params: { id: string } }>(
    '/me/auth-methods/:id',
    {
      onRequest: [app.authenticate],
      preHandler: [requireRecentStepUpPreHandler],
      schema: {
        summary: 'Remove auth method',
        description:
          "Removes an authentication method from the user's account. Cannot remove the last auth method.",
        tags: ['Auth', 'Auth Method'],
        params: authMethodIdParamsDto,
      },
    },
    controller.deleteAuthMethod,
  );
  zodApplication.get(
    '/me/sessions',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'List my active sessions',
        description:
          'Returns all active sessions for the authenticated user, including device and location info.',
        tags: ['Auth', 'Session'],
      },
    },
    controller.listSessions,
  );
  zodApplication.delete<{ Params: { id: string } }>(
    '/me/sessions/:id',
    {
      onRequest: [app.authenticate],
      schema: {
        summary: 'Revoke a specific session',
        description:
          'Revokes a specific session by its ID. Cannot revoke the current session (use logout instead).',
        tags: ['Auth', 'Session'],
        params: sessionIdParamsDto,
      },
    },
    controller.revokeSession,
  );
};
