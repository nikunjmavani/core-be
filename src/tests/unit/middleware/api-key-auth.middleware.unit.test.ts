import { createHash } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyApiKeyAuthentication,
  extractApiKeyFromRequest,
} from '@/shared/middlewares/security/api-key-auth.middleware.js';

function createRequest(authorization?: string, xApiKey?: string) {
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  if (xApiKey) headers['x-api-key'] = xApiKey;
  return { headers } as never;
}

describe('api-key-auth.middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractApiKeyFromRequest', () => {
    it('returns null when no api key headers are present', () => {
      expect(extractApiKeyFromRequest(createRequest())).toBeNull();
    });

    it('extracts api keys from Authorization: ApiKey header', () => {
      const rawKey = 'ak_deadbeef';
      expect(extractApiKeyFromRequest(createRequest(`ApiKey ${rawKey}`))).toBe(rawKey);
    });

    it('extracts api keys from Authorization: Bearer header', () => {
      const rawKey = 'ak_cafebabe';
      expect(extractApiKeyFromRequest(createRequest(`Bearer ${rawKey}`))).toBe(rawKey);
    });

    it('extracts api keys from x-api-key header', () => {
      const rawKey = 'ak_feedface';
      expect(extractApiKeyFromRequest(createRequest(undefined, rawKey))).toBe(rawKey);
    });

    it('ignores bearer tokens that are not api keys', () => {
      expect(extractApiKeyFromRequest(createRequest('Bearer eyJhbGciOiJIUzI1NiJ9'))).toBeNull();
    });
  });

  describe('applyApiKeyAuthentication', () => {
    let application: Awaited<ReturnType<typeof createApplication>>;

    async function createApplication() {
      const fastifyApplication = Fastify();
      fastifyApplication.decorate('tenancyDomain', {
        organizationApiKeyService: {
          authenticate: vi.fn().mockResolvedValue({
            public_id: 'key_public_id',
            organization_public_id: 'org_public_id',
            scopes: ['api-key:read'],
          }),
        },
      } as never);
      await fastifyApplication.ready();
      return fastifyApplication;
    }

    afterEach(async () => {
      if (application) {
        await application.close();
      }
    });

    it('returns false when no api key is sent', async () => {
      application = await createApplication();
      const request = { headers: {}, server: application } as never;
      await expect(applyApiKeyAuthentication(request)).resolves.toBe(false);
    });

    it('populates request.auth when authenticate succeeds', async () => {
      application = await createApplication();
      const request = {
        headers: { authorization: 'ApiKey ak_validkey000000000000000000000000' },
        server: application,
      } as FastifyRequest;

      await expect(applyApiKeyAuthentication(request)).resolves.toBe(true);
      expect(request.auth).toEqual({
        kind: 'apiKey',
        apiKeyPublicId: 'key_public_id',
        apiKeyScopes: ['api-key:read'],
        organizationPublicId: 'org_public_id',
      });
      expect(request.organizationId).toBe('org_public_id');
    });

    it('throws when api key is invalid', async () => {
      application = await createApplication();
      vi.mocked(
        application.tenancyDomain.organizationApiKeyService.authenticate,
      ).mockResolvedValueOnce(null);
      const request = {
        headers: { authorization: 'ApiKey ak_invalid000000000000000000000000' },
        server: application,
      } as never;

      await expect(applyApiKeyAuthentication(request)).rejects.toMatchObject({
        statusCode: 401,
      });
    });

    // The timing-safe comparator (`hashesMatch`) is passed into the service and is the actual
    // secret-comparison primitive. The other tests stub `authenticate` so it never runs, leaving
    // it unverified; these drive it directly through the real flow.
    const RAW_KEY = 'ak_validkey000000000000000000000000';
    const KEY_HASH = createHash('sha256').update(RAW_KEY, 'utf8').digest('hex');

    it('authenticates when the timing-safe comparator matches equal-length hashes', async () => {
      application = await createApplication();
      vi.mocked(
        application.tenancyDomain.organizationApiKeyService.authenticate,
      ).mockImplementationOnce(async (_prefix: string, candidateHash: string, compare) =>
        compare(KEY_HASH, candidateHash)
          ? { public_id: 'k', organization_public_id: 'o', scopes: [] }
          : null,
      );
      const request = {
        headers: { authorization: `ApiKey ${RAW_KEY}` },
        server: application,
      } as never;

      await expect(applyApiKeyAuthentication(request)).resolves.toBe(true);
    });

    it('rejects when the timing-safe comparator sees a length mismatch (no false positive)', async () => {
      application = await createApplication();
      vi.mocked(
        application.tenancyDomain.organizationApiKeyService.authenticate,
      ).mockImplementationOnce(async (_prefix: string, candidateHash: string, compare) =>
        // 'abcd' decodes to 2 bytes vs the 32-byte candidate → the length guard must return false
        // before timingSafeEqual (which would otherwise throw on unequal lengths).
        compare('abcd', candidateHash)
          ? { public_id: 'k', organization_public_id: 'o', scopes: [] }
          : null,
      );
      const request = {
        headers: { authorization: `ApiKey ${RAW_KEY}` },
        server: application,
      } as never;

      await expect(applyApiKeyAuthentication(request)).rejects.toMatchObject({ statusCode: 401 });
    });
  });
});
