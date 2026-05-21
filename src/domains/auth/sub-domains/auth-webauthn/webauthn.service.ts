import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { env } from '@/shared/config/env.config.js';
import { MILLISECONDS_PER_DAY } from '@/shared/constants/index.js';
import { resolveAccessTokenRoleForUser } from '@/shared/utils/auth/global-admin-role.util.js';
import { signAccessToken } from '@/shared/utils/security/jwt.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthSessionService } from '../auth-session/auth-session.service.js';
import type { WebauthnCredentialRepository } from './webauthn-credential.repository.js';
import { consumeWebauthnChallenge, createWebauthnChallenge } from './webauthn-challenge.js';
import {
  resolveWebauthnExpectedOrigin,
  resolveWebauthnRelyingPartyId,
  resolveWebauthnRelyingPartyName,
} from './webauthn.config.js';
import {
  validateWebauthnAuthenticateOptions,
  validateWebauthnAuthenticateVerify,
  validateWebauthnRegisterVerify,
} from './webauthn.validator.js';

export type WebauthnRegisterOptionsResult = {
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
  challenge_token: string;
};

export type WebauthnAuthenticateOptionsResult = {
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  challenge_token: string;
};

export class WebauthnService {
  constructor(
    private readonly userService: UserService,
    private readonly authSessionService: AuthSessionService,
    private readonly credentialRepository: WebauthnCredentialRepository,
    private readonly redis: Redis,
  ) {}

  async generateRegistrationOptions(
    userPublicId: string,
    requestOrigin?: string,
  ): Promise<WebauthnRegisterOptionsResult> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) {
      throw new UnauthorizedError('errors:userNotFound');
    }

    const existingCredentials = await this.credentialRepository.listActiveByUserId(user.id);
    const relyingPartyId = resolveWebauthnRelyingPartyId();
    const options = await generateRegistrationOptions({
      rpName: resolveWebauthnRelyingPartyName(),
      rpID: relyingPartyId,
      userName: user.email,
      userDisplayName: user.email,
      userID: Buffer.from(user.public_id, 'utf8'),
      attestationType: 'none',
      excludeCredentials: existingCredentials.map((credential) => ({
        id: credential.credential_id,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    const challengeToken = await createWebauthnChallenge(
      this.redis,
      'registration',
      user.public_id,
      options.challenge,
    );

    void requestOrigin;
    return { options, challenge_token: challengeToken };
  }

  async verifyRegistration(
    userPublicId: string,
    body: unknown,
    requestOrigin?: string,
  ): Promise<{ verified: boolean; credential_id: string }> {
    const parsed = validateWebauthnRegisterVerify(body);
    const challenge = await consumeWebauthnChallenge(
      this.redis,
      parsed.challenge_token,
      'registration',
    );
    if (challenge.user_public_id !== userPublicId) {
      throw new UnauthorizedError('errors:webauthnInvalidChallenge');
    }

    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) {
      throw new UnauthorizedError('errors:userNotFound');
    }

    const expectedOrigin = resolveWebauthnExpectedOrigin(requestOrigin);
    const verification = await verifyRegistrationResponse({
      response: parsed.response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin,
      expectedRPID: resolveWebauthnRelyingPartyId(),
      requireUserVerification: true,
    });

    if (!(verification.verified && verification.registrationInfo)) {
      throw new ValidationError('errors:webauthnRegistrationFailed');
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    const created = await this.credentialRepository.createCredential({
      user_id: user.id,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      device_type: credentialDeviceType,
      backed_up: credentialBackedUp,
      transports: credential.transports ?? [],
    });

    return { verified: true, credential_id: created.credential_id };
  }

  async generateAuthenticationOptions(
    body: unknown,
    requestOrigin?: string,
  ): Promise<WebauthnAuthenticateOptionsResult> {
    const parsed = validateWebauthnAuthenticateOptions(body);
    if (!parsed.email) {
      throw new ValidationError('errors:webauthnEmailRequired');
    }

    const user = await this.userService.findByEmail(parsed.email);
    if (!user) {
      throw new UnauthorizedError('errors:invalidEmailOrPassword');
    }

    const credentials = await this.credentialRepository.listActiveByUserId(user.id);
    if (credentials.length === 0) {
      throw new UnauthorizedError('errors:webauthnNoCredentials');
    }

    const options = await generateAuthenticationOptions({
      rpID: resolveWebauthnRelyingPartyId(),
      allowCredentials: credentials.map((credential) => ({
        id: credential.credential_id,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: 'preferred',
    });

    const challengeToken = await createWebauthnChallenge(
      this.redis,
      'authentication',
      user.public_id,
      options.challenge,
    );

    void requestOrigin;
    return { options, challenge_token: challengeToken };
  }

  async verifyAuthentication(
    body: unknown,
    ipAddress: string,
    requestOrigin?: string,
    userAgent?: string,
  ): Promise<{ access_token: string; session_public_id: string }> {
    const parsed = validateWebauthnAuthenticateVerify(body);
    const challenge = await consumeWebauthnChallenge(
      this.redis,
      parsed.challenge_token,
      'authentication',
    );

    const response = parsed.response as unknown as AuthenticationResponseJSON;
    const storedCredential = await this.credentialRepository.findActiveByCredentialId(response.id);
    if (!storedCredential || storedCredential.user_id === undefined) {
      throw new UnauthorizedError('errors:webauthnCredentialNotFound');
    }

    const user = await this.userService.requireUserRecordByPublicId(challenge.user_public_id);
    if (!user || user.id !== storedCredential.user_id) {
      throw new UnauthorizedError('errors:webauthnInvalidChallenge');
    }

    const expectedOrigin = resolveWebauthnExpectedOrigin(requestOrigin);
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin,
      expectedRPID: resolveWebauthnRelyingPartyId(),
      requireUserVerification: true,
      credential: {
        id: storedCredential.credential_id,
        publicKey: Buffer.from(storedCredential.public_key, 'base64url'),
        counter: storedCredential.counter,
        transports: storedCredential.transports as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) {
      throw new UnauthorizedError('errors:webauthnAuthenticationFailed');
    }

    const { newCounter } = verification.authenticationInfo;
    await this.credentialRepository.updateCounter(storedCredential.credential_id, newCounter);

    const jsonWebToken = await signAccessToken({
      userId: user.public_id,
      role: resolveAccessTokenRoleForUser(user.email, user.status),
    });
    const tokenHash = createHash('sha256').update(jsonWebToken).digest('hex');
    const sessionMaxAgeDays = env.SESSION_MAX_AGE_DAYS;
    const expiresAt = new Date(Date.now() + sessionMaxAgeDays * MILLISECONDS_PER_DAY);
    const authSession = await this.authSessionService.createSessionForUser(
      user.public_id,
      omitUndefined({
        token_hash: tokenHash,
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: expiresAt,
      }),
    );

    return { access_token: jsonWebToken, session_public_id: authSession.public_id };
  }
}
