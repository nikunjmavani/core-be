import { createHmac } from 'node:crypto';
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
import { env } from '@/shared/config/env.config.js';
import { UnauthorizedError, ValidationError } from '@/shared/errors/index.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { assertUserAccountActive } from '@/shared/utils/auth/account-status.util.js';
import { withUserDatabaseContext } from '@/infrastructure/database/contexts/user-database.context.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { AuthSessionService } from '@/domains/auth/sub-domains/auth-session/auth-session.service.js';
import type { WebauthnCredentialRepository } from './webauthn-credential.repository.js';
import type { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { MfaService } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa.service.js';
import {
  completeFirstFactorAuth,
  type FirstFactorAuthResult,
} from '@/domains/auth/shared/complete-first-factor-auth.js';
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

/**
 * Result envelope returned by {@link WebauthnService.generateRegistrationOptions}.
 *
 * @remarks
 * - **Algorithm:** wraps the raw `@simplewebauthn/server` registration options
 *   plus the opaque `challenge_token` that the client must echo back at verify time.
 * - **Failure modes:** purely a shape; consumers should treat `options` as opaque.
 * - **Side effects:** none.
 * - **Notes:** the `challenge_token` indexes a Redis-stored challenge with a short TTL.
 */
export type WebauthnRegisterOptionsResult = {
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
  challenge_token: string;
};

/**
 * Result envelope returned by {@link WebauthnService.generateAuthenticationOptions}.
 *
 * @remarks
 * - **Algorithm:** wraps the raw `@simplewebauthn/server` authentication options plus
 *   the opaque `challenge_token` paired with the user's pending challenge in Redis.
 * - **Failure modes:** purely a shape; consumers should treat `options` as opaque.
 * - **Side effects:** none.
 * - **Notes:** the `challenge_token` is consumed once at verify time and bound to the
 *   originating user via {@link consumeWebauthnChallenge}.
 */
export type WebauthnAuthenticateOptionsResult = {
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  challenge_token: string;
};

/**
 * Passkey (WebAuthn) enrollment and login orchestrator.
 *
 * @remarks
 * - **Algorithm:** uses `@simplewebauthn/server` to produce registration and
 *   authentication options, persists the challenge in Redis via
 *   {@link createWebauthnChallenge}, and on verify consumes the challenge via
 *   {@link consumeWebauthnChallenge}. Registration stores the new credential in
 *   {@link webauthn_credentials}; authentication validates the assertion, bumps
 *   the stored signature counter via {@link WebauthnCredentialRepository.updateCounter},
 *   and mints a JWT + session.
 * - **Failure modes:** mismatched challenge user, replayed/forged assertions, or
 *   counter regression surface as `UnauthorizedError` or `ValidationError` with
 *   WebAuthn-specific i18n keys (`errors:webauthnInvalidChallenge`,
 *   `errors:webauthnNoCredentials`, `errors:webauthnAuthenticationFailed`, …). The
 *   `authenticate/options` step never reveals account existence: unknown emails and
 *   emails without passkeys receive deterministic decoy options instead of an error.
 * - **Side effects:** writes to {@link webauthn_credentials} (`createCredential`,
 *   `updateCounter`), to `auth.sessions` via {@link AuthSessionService.createSessionForUser},
 *   and to Redis (`webauthn:challenge:*`). Signs an RS256 JWT on successful login.
 * - **Notes:** RP ID and expected origin are resolved at call time from
 *   `WEBAUTHN_RP_ID` / `ALLOWED_ORIGINS` so the same binary serves multiple environments.
 */
export class WebauthnService {
  constructor(
    private readonly userService: UserService,
    private readonly authSessionService: AuthSessionService,
    private readonly credentialRepository: WebauthnCredentialRepository,
    private readonly redis: Redis,
    private readonly organizationSettingsService: OrganizationSettingsService,
    private readonly mfaService: MfaService,
  ) {}

  async generateRegistrationOptions(
    userPublicId: string,
    requestOrigin?: string,
  ): Promise<WebauthnRegisterOptionsResult> {
    const user = await this.userService.requireUserRecordByPublicId(userPublicId);
    if (!user) {
      throw new UnauthorizedError('errors:userNotFound');
    }

    const existingCredentials = await withUserDatabaseContext(user.public_id, () =>
      this.credentialRepository.listActiveByUserId(user.id),
    );
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
    const created = await withUserDatabaseContext(user.public_id, () =>
      this.credentialRepository.createCredential({
        user_id: user.id,
        credential_id: credential.id,
        public_key: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        device_type: credentialDeviceType,
        backed_up: credentialBackedUp,
        transports: credential.transports ?? [],
      }),
    );

    return { verified: true, credential_id: created.credential_id };
  }

  async generateAuthenticationOptions(
    body: unknown,
    requestOrigin?: string,
  ): Promise<WebauthnAuthenticateOptionsResult> {
    const parsed = validateWebauthnAuthenticateOptions(body);
    if (!parsed.email) {
      throw new UnauthorizedError('errors:invalidEmailOrPassword');
    }

    const user = await this.userService.findByEmail(parsed.email);
    const credentials = user
      ? await withUserDatabaseContext(user.public_id, () =>
          this.credentialRepository.listActiveByUserId(user.id),
        )
      : [];

    // Anti-enumeration: never let the response reveal whether `email` maps to an account
    // that has passkeys. Unknown accounts (and known accounts without credentials) receive
    // structurally identical decoy options keyed deterministically on the email, so the
    // 200 + allowCredentials payload is indistinguishable from a genuine challenge. The
    // follow-up verify fails uniformly because no authenticator can satisfy the decoy.
    if (!user || credentials.length === 0) {
      void requestOrigin;
      return this.buildDecoyAuthenticationOptions(parsed.email);
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

  /**
   * Builds decoy authentication options for an email that has no usable passkey, so the
   * `authenticate/options` endpoint cannot be used as an account/credential enumeration oracle.
   *
   * @remarks
   * - **Algorithm:** derives a single stable decoy credential id from
   *   `HMAC-SHA256(SECRETS_ENCRYPTION_KEY, "webauthn-auth-decoy:" + lowercased email)` so
   *   repeated probes for the same email return identical credential descriptors (a real
   *   account's credential ids are likewise stable). Generates real `simplewebauthn` options
   *   around that decoy and stores a challenge bound to a non-resolvable synthetic user.
   * - **Failure modes:** none surfaced to the caller — the point is to return a 200 that mirrors
   *   the genuine shape; the eventual verify fails uniformly via the standard credential lookup.
   * - **Side effects:** writes a short-lived `webauthn:challenge:*` entry to Redis.
   * - **Notes:** the synthetic `decoy:<publicId>` owner never matches a real user, so even if the
   *   client echoes the challenge back, `verifyAuthentication` rejects it like any other mismatch.
   */
  private async buildDecoyAuthenticationOptions(
    email: string,
  ): Promise<WebauthnAuthenticateOptionsResult> {
    const decoyCredentialId = createHmac('sha256', env.SECRETS_ENCRYPTION_KEY)
      .update(`webauthn-auth-decoy:${email.toLowerCase()}`)
      .digest()
      .toString('base64url');

    const options = await generateAuthenticationOptions({
      rpID: resolveWebauthnRelyingPartyId(),
      allowCredentials: [{ id: decoyCredentialId, transports: ['internal'] }],
      userVerification: 'preferred',
    });

    const challengeToken = await createWebauthnChallenge(
      this.redis,
      'authentication',
      `decoy:${generatePublicId()}`,
      options.challenge,
    );

    return { options, challenge_token: challengeToken };
  }

  async verifyAuthentication(
    body: unknown,
    ipAddress: string,
    requestOrigin?: string,
    userAgent?: string,
  ): Promise<FirstFactorAuthResult> {
    const parsed = validateWebauthnAuthenticateVerify(body);
    const challenge = await consumeWebauthnChallenge(
      this.redis,
      parsed.challenge_token,
      'authentication',
    );

    const response = parsed.response as unknown as AuthenticationResponseJSON;
    // The challenge binds this assertion to a user; auth.webauthn_credentials is FORCE RLS keyed on
    // app.current_user_id, so look the credential up inside that user's context.
    const storedCredential = await withUserDatabaseContext(challenge.user_public_id, () =>
      this.credentialRepository.findActiveByCredentialId(response.id),
    );
    if (storedCredential?.user_id === undefined) {
      throw new UnauthorizedError('errors:webauthnCredentialNotFound');
    }

    const user = await this.userService.requireUserRecordByPublicId(challenge.user_public_id);
    if (!user || user.id !== storedCredential.user_id) {
      throw new UnauthorizedError('errors:webauthnInvalidChallenge');
    }
    assertUserAccountActive(user.status);

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
    await withUserDatabaseContext(user.public_id, () =>
      this.credentialRepository.updateCounter(storedCredential.credential_id, newCounter),
    );

    return completeFirstFactorAuth({
      user: {
        id: user.id,
        public_id: user.public_id,
        email: user.email,
        status: user.status,
        is_email_verified: user.is_email_verified,
        is_mfa_enabled: user.is_mfa_enabled,
      },
      ipAddress,
      userAgent,
      organizationSettingsService: this.organizationSettingsService,
      mfaService: this.mfaService,
      authSessionService: this.authSessionService,
    });
  }
}
