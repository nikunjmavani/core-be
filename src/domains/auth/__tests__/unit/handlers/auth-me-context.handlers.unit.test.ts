import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@/shared/errors/index.js';

vi.mock('@/domains/auth/auth-me-context.serializer.js', () => ({
  serializeAuthMeContext: (data: unknown) => ({ serialized: 'meContext', data }),
}));

vi.mock('@/shared/utils/http/response.util.js', () => ({
  successResponse: (data: unknown, requestId: unknown) => ({ data, requestId }),
}));

const { createAuthMeContextHandlers } = await import(
  '@/domains/auth/handlers/auth-me-context.handlers.js'
);

function buildRequest(auth: unknown): FastifyRequest {
  return { id: 'req_test', auth } as unknown as FastifyRequest;
}

const reply = {} as FastifyReply;

/**
 * `GET /auth/me/context` is the single authoritative call the frontend makes to learn who the
 * caller is: identity, active organization, resolved permissions, global role and the org-switcher
 * list. Everything the client renders — and every client-side gate — keys off this response.
 *
 * The handler is thin, which is exactly why the mapping matters: it forwards three fields from the
 * verified JWT claims into the service. Passing the wrong one (an organization id where a user id
 * belongs, or a client-supplied value in place of a claim) would resolve another principal's
 * context, so the argument shape is asserted field by field rather than as a whole object.
 */
describe('auth-me-context.handlers', () => {
  const getContext = vi.fn();
  const handlers = createAuthMeContextHandlers({
    authMeContextService: { getContext },
  } as never);

  const auth = {
    kind: 'user',
    userId: 'usr_abcdefghijklmnopqrst',
    organizationPublicId: 'org_abcdefghijklmnopqrst',
    role: 'admin',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getContext.mockResolvedValue({ user: { id: auth.userId } });
  });

  it('resolves context for the authenticated caller', async () => {
    await handlers.getMeContext(buildRequest(auth), reply);

    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('takes the user id from the verified JWT claim', async () => {
    await handlers.getMeContext(buildRequest(auth), reply);

    expect(getContext).toHaveBeenCalledWith(expect.objectContaining({ userPublicId: auth.userId }));
  });

  it('takes the active organization from the signed org claim', async () => {
    // The active org rides the token, never a header or path segment — so this mapping is the
    // whole tenancy boundary for this route.
    await handlers.getMeContext(buildRequest(auth), reply);

    expect(getContext).toHaveBeenCalledWith(
      expect.objectContaining({ activeOrganizationPublicId: auth.organizationPublicId }),
    );
  });

  it('takes the global role from the claim', async () => {
    await handlers.getMeContext(buildRequest(auth), reply);

    expect(getContext).toHaveBeenCalledWith(expect.objectContaining({ globalRole: auth.role }));
  });

  it('passes exactly the three documented fields, nothing more', async () => {
    await handlers.getMeContext(buildRequest(auth), reply);

    const argument = getContext.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(argument).sort()).toEqual(
      ['activeOrganizationPublicId', 'globalRole', 'userPublicId'].sort(),
    );
  });

  it('forwards a personal-mode caller with no active organization', async () => {
    // Personal mode is a legitimate state: the claim is absent, not an error.
    await handlers.getMeContext(buildRequest({ ...auth, organizationPublicId: undefined }), reply);

    expect(getContext).toHaveBeenCalledWith(
      expect.objectContaining({ activeOrganizationPublicId: undefined }),
    );
  });

  it('serializes the service result through the context serializer', async () => {
    const context = { user: { id: auth.userId }, permissions: ['organization:read'] };
    getContext.mockResolvedValue(context);

    const result = await handlers.getMeContext(buildRequest(auth), reply);

    expect(result).toEqual({
      data: { serialized: 'meContext', data: context },
      requestId: 'req_test',
    });
  });

  describe('unauthenticated callers', () => {
    it.each([
      ['no auth context', undefined],
      ['an API-key principal', { kind: 'organization-api-key', organizationId: 'org_1' }],
    ])('rejects %s before calling the service', async (_label, principal) => {
      await expect(handlers.getMeContext(buildRequest(principal), reply)).rejects.toBeInstanceOf(
        UnauthorizedError,
      );

      expect(getContext).not.toHaveBeenCalled();
    });
  });
});
