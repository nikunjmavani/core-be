import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { captchaPreHandler } from '@/shared/middlewares/captcha.middleware.js';
import {
  REFRESH_RATE_LIMIT,
  STRICT_AUTHED_RATE_LIMIT,
  STRICT_PUBLIC_RATE_LIMIT,
} from '@/shared/middlewares/rate-limit-presets.constants.js';
import { createAuthController } from './auth.controller.js';
import {
  authMethodIdParamsDto,
  ChangePasswordDto,
  CreateAuthMethodDto,
  ForgotPasswordDto,
  LoginDto,
  MagicLinkSendDto,
  MagicLinkVerifyDto,
  MfaChallengeDto,
  MfaEnrollDto,
  MfaVerifyDto,
  mfaMethodIdParamsDto,
  OauthCallbackQueryDto,
  oauthProviderParamsDto,
  ResetPasswordDto,
  sessionIdParamsDto,
  VerifyEmailDto,
} from './auth.dto.js';
import {
  webauthnAuthenticateOptionsDto,
  webauthnAuthenticateVerifyDto,
  webauthnRegisterVerifyDto,
} from './sub-domains/auth-webauthn/webauthn.dto.js';

export const authRoutesPlugin: FastifyPluginAsync = async (app) => {
  const controller = createAuthController(app.authDomain);
  const zodApplication = app.withTypeProvider<ZodTypeProvider>();

  // Public — strict rate limits on login/magic-link/password endpoints
  zodApplication.post('/login', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: { body: LoginDto },
    handler: controller.login,
  });
  zodApplication.post('/logout', { ...STRICT_PUBLIC_RATE_LIMIT, schema: {} }, controller.logout);
  zodApplication.post('/magic-link/send', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: { body: MagicLinkSendDto },
    handler: controller.sendMagicLink,
  });
  zodApplication.post('/magic-link/verify', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    schema: { body: MagicLinkVerifyDto },
    handler: controller.verifyMagicLink,
  });
  zodApplication.get(
    '/oauth/providers',
    { ...STRICT_PUBLIC_RATE_LIMIT, schema: {} },
    controller.listOauthProviders,
  );
  zodApplication.get('/oauth/:provider', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: { params: oauthProviderParamsDto },
    handler: controller.oauthRedirect,
  });
  zodApplication.get('/oauth/:provider/callback', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    schema: { params: oauthProviderParamsDto, querystring: OauthCallbackQueryDto },
    handler: controller.oauthCallback,
  });
  zodApplication.post('/password/forgot', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: { body: ForgotPasswordDto },
    handler: controller.forgotPassword,
  });
  zodApplication.post('/password/reset', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: { body: ResetPasswordDto },
    handler: controller.resetPassword,
  });
  zodApplication.post('/email/verify', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    preHandler: [captchaPreHandler],
    schema: { body: VerifyEmailDto },
    handler: controller.verifyEmail,
  });
  zodApplication.post(
    '/mfa/challenge',
    {
      ...STRICT_PUBLIC_RATE_LIMIT,
      schema: { body: MfaChallengeDto },
    },
    controller.challengeMfa,
  );
  zodApplication.post('/webauthn/authenticate/options', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    schema: { body: webauthnAuthenticateOptionsDto },
    handler: controller.webauthnAuthenticateOptions,
  });
  zodApplication.post('/webauthn/authenticate/verify', {
    ...STRICT_PUBLIC_RATE_LIMIT,
    schema: { body: webauthnAuthenticateVerifyDto },
    handler: controller.webauthnAuthenticateVerify,
  });
  zodApplication.post('/refresh', { ...REFRESH_RATE_LIMIT, schema: {} }, controller.refreshToken);

  // Authenticated
  zodApplication.post(
    '/password/change',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: { body: ChangePasswordDto },
    },
    controller.changePassword,
  );
  zodApplication.post(
    '/email/resend-verification',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: {},
    },
    controller.resendEmailVerification,
  );
  zodApplication.post(
    '/mfa/enroll',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: { body: MfaEnrollDto },
    },
    controller.enrollMfa,
  );
  zodApplication.post(
    '/webauthn/register/options',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: {},
    },
    controller.webauthnRegisterOptions,
  );
  zodApplication.post(
    '/webauthn/register/verify',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: { body: webauthnRegisterVerifyDto },
    },
    controller.webauthnRegisterVerify,
  );
  zodApplication.get(
    '/mfa',
    { onRequest: [app.authenticate], schema: {} },
    controller.listMfaMethods,
  );
  zodApplication.delete<{ Params: { mfaMethodId: string } }>(
    '/mfa/:mfaMethodId',
    {
      onRequest: [app.authenticate],
      schema: { params: mfaMethodIdParamsDto },
    },
    controller.deleteMfa,
  );
  zodApplication.delete(
    '/me/sessions',
    { onRequest: [app.authenticate], schema: {} },
    controller.revokeAllSessions,
  );
  zodApplication.post(
    '/mfa/verify',
    {
      onRequest: [app.authenticate],
      ...STRICT_AUTHED_RATE_LIMIT,
      schema: { body: MfaVerifyDto },
    },
    controller.verifyMfa,
  );
  zodApplication.get(
    '/me/auth-methods',
    { onRequest: [app.authenticate], schema: {} },
    controller.listAuthMethods,
  );
  zodApplication.post(
    '/me/auth-methods',
    { onRequest: [app.authenticate], schema: { body: CreateAuthMethodDto } },
    controller.createAuthMethod,
  );
  zodApplication.delete<{ Params: { id: string } }>(
    '/me/auth-methods/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: authMethodIdParamsDto },
    },
    controller.deleteAuthMethod,
  );
  zodApplication.get(
    '/me/sessions',
    { onRequest: [app.authenticate], schema: {} },
    controller.listSessions,
  );
  zodApplication.delete<{ Params: { id: string } }>(
    '/me/sessions/:id',
    {
      onRequest: [app.authenticate],
      schema: { params: sessionIdParamsDto },
    },
    controller.revokeSession,
  );
};
