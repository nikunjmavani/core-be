import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, UnauthorizedError } from '@/shared/errors/index.js';
import { recordRecentStepUp, type StepUpFactor } from '@/shared/utils/auth/recent-step-up.util.js';

const redisStore = new Map<string, string>();

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: {
    get: async (key: string) => redisStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    },
  },
}));

const { requireRecentStepUpPreHandler, requireStrongRecentStepUpPreHandler } = await import(
  '@/shared/middlewares/core/recent-step-up.middleware.js'
);

/** Writes a real sentinel through the production util so key derivation is exercised, not faked. */
const storeBackedRedis = {
  get: async (key: string) => redisStore.get(key) ?? null,
  set: async (key: string, value: string) => {
    redisStore.set(key, value);
    return 'OK';
  },
} as unknown as Redis;

function buildRequest(auth: unknown): FastifyRequest {
  return { auth } as unknown as FastifyRequest;
}

function buildUserAuth(userId: string, sessionPublicId: string | undefined): unknown {
  return { kind: 'user', userId, sessionPublicId };
}

const reply = {} as FastifyReply;

const USER = 'user_abcdefghijklmnopqrstu';
const SESSION = 'sess_abcdefghijklmnopqrst';
const OTHER_USER = 'user_zyxwvutsrqponmlkjihg';
const OTHER_SESSION = 'sess_zyxwvutsrqponmlkjih';

async function grantStepUp(
  userId: string,
  sessionPublicId: string,
  factor: StepUpFactor,
): Promise<void> {
  await recordRecentStepUp(storeBackedRedis, userId, sessionPublicId, factor);
}

/**
 * The two step-up preHandlers are the gate in front of every credential and session mutation.
 * They must fail CLOSED — no sentinel, wrong session, wrong user, or a weak bootstrap factor on a
 * destructive route all have to reject. Nothing exercised these handlers directly before.
 */
describe('recent-step-up.middleware', () => {
  beforeEach(() => {
    redisStore.clear();
  });

  describe('requireRecentStepUpPreHandler (enroll-grade gate)', () => {
    it.each(['password', 'mfa', 'email_code'] as const)(
      'passes when the session holds a recent %s step-up',
      async (factor) => {
        await grantStepUp(USER, SESSION, factor);

        await expect(
          requireRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, SESSION)), reply),
        ).resolves.toBeUndefined();
      },
    );

    it('throws ForbiddenError with the documented key when no step-up exists', async () => {
      const promise = requireRecentStepUpPreHandler(
        buildRequest(buildUserAuth(USER, SESSION)),
        reply,
      );

      await expect(promise).rejects.toBeInstanceOf(ForbiddenError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 403,
        messageKey: 'errors:recentStepUpRequired',
      });
    });

    it('rejects a step-up earned on a DIFFERENT session for the same user (sec-A2)', async () => {
      await grantStepUp(USER, OTHER_SESSION, 'password');

      await expect(
        requireRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, SESSION)), reply),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('rejects a step-up earned by a DIFFERENT user on the same session id', async () => {
      await grantStepUp(OTHER_USER, SESSION, 'password');

      await expect(
        requireRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, SESSION)), reply),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('fails closed when the auth context carries no sessionPublicId', async () => {
      await grantStepUp(USER, SESSION, 'password');

      await expect(
        requireRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, undefined)), reply),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('requireStrongRecentStepUpPreHandler (destructive-grade gate)', () => {
    it.each(['password', 'mfa'] as const)('passes on a strong %s step-up', async (factor) => {
      await grantStepUp(USER, SESSION, factor);

      await expect(
        requireStrongRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, SESSION)), reply),
      ).resolves.toBeUndefined();
    });

    it('rejects an email_code bootstrap window — it may enroll, never revoke or delete', async () => {
      await grantStepUp(USER, SESSION, 'email_code');

      // The weaker gate accepts this same sentinel; the destructive gate must not.
      await expect(
        requireRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, SESSION)), reply),
      ).resolves.toBeUndefined();

      const promise = requireStrongRecentStepUpPreHandler(
        buildRequest(buildUserAuth(USER, SESSION)),
        reply,
      );
      await expect(promise).rejects.toBeInstanceOf(ForbiddenError);
      await expect(promise).rejects.toMatchObject({
        statusCode: 403,
        messageKey: 'errors:strongStepUpRequired',
      });
    });

    it('rejects a legacy sentinel whose value is not a known factor', async () => {
      // Sentinels written before factors were tracked hold a session id, not a factor.
      redisStore.set(`step-up:${USER}:${SESSION}`, SESSION);

      await expect(
        requireStrongRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, SESSION)), reply),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('rejects a strong step-up earned on a different session', async () => {
      await grantStepUp(USER, OTHER_SESSION, 'mfa');

      await expect(
        requireStrongRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, SESSION)), reply),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('fails closed when the auth context carries no sessionPublicId', async () => {
      await grantStepUp(USER, SESSION, 'mfa');

      await expect(
        requireStrongRecentStepUpPreHandler(buildRequest(buildUserAuth(USER, undefined)), reply),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('unauthenticated callers', () => {
    it.each([
      ['no auth context', undefined],
      ['an API-key principal', { kind: 'organization-api-key', organizationId: 'org_1' }],
    ])('rejects %s before any Redis lookup', async (_label, auth) => {
      // requireAuth throws Unauthorized (401) — the gate must not degrade that to a 403,
      // and must not treat a non-user principal as a user with a step-up window.
      await expect(requireRecentStepUpPreHandler(buildRequest(auth), reply)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );
      await expect(
        requireStrongRecentStepUpPreHandler(buildRequest(auth), reply),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });
});
