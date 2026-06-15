import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictError, NotFoundError } from '@/shared/errors/index.js';

vi.mock('@/infrastructure/database/resource-cap-lock.js', () => ({
  RESOURCE_CAP_ADVISORY_LOCK_NAMESPACES: {
    OWNED_ORGANIZATION: 1,
    ORGANIZATION_API_KEY: 2,
    ORGANIZATION_NOTIFICATION_POLICY: 3,
    MEMBER_ROLE: 4,
  },
  acquireResourceCapAdvisoryLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: (_organizationPublicId: string, callback: () => unknown) =>
    callback(),
}));

// The grant-permission guard has its own tests; here it is a no-op so we focus on lifecycle flow.
vi.mock('@/domains/tenancy/sub-domains/permission/assert-grantable-permissions.util.js', () => ({
  assertCallerCanGrantPermissionCodes: vi.fn().mockResolvedValue(undefined),
}));

// Passthrough serializer (its own no-secret unit test covers shaping); keep the focus on the service.
vi.mock(
  '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.serializer.js',
  () => ({
    serializeOrganizationApiKey: (row: { public_id: string }) => ({
      id: row.public_id,
      ...row,
    }),
  }),
);

import { OrganizationApiKeyService } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.service.js';

const ORG = { id: 1, public_id: 'org_public' };
const KEY_ROW = {
  public_id: 'apikey_public',
  name: 'CI Key',
  key_prefix: 'ak_12345',
  scopes: ['api-key:read'],
  status: 'ACTIVE',
};

function buildService() {
  const organizationRepository = {
    findByPublicId: vi.fn().mockResolvedValue(ORG),
    resolveUserIdByPublicId: vi.fn().mockResolvedValue(42),
  };
  const apiKeyRepository = {
    findByOrganizationId: vi.fn().mockResolvedValue({ items: [KEY_ROW], next_cursor: null }),
    findByPublicId: vi.fn().mockResolvedValue(KEY_ROW),
    // sec-r5-followup-ratelimit-dos-1: create() now consults this guard
    // before insert. Default to 0 so existing tests still reach the create
    // path; the cap regression lives in `per-org-row-caps.unit.test.ts`.
    countActiveByOrganization: vi.fn().mockResolvedValue(0),
    // audit-#8: per-org creation quota advisory lock (no-op in unit tests).
    acquireCreationQuotaLock: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(KEY_ROW),
    update: vi.fn().mockResolvedValue({ ...KEY_ROW, name: 'Renamed' }),
    softDelete: vi.fn().mockResolvedValue(KEY_ROW),
  };
  const service = new OrganizationApiKeyService(
    organizationRepository as never,
    apiKeyRepository as never,
    { resolveUserOrganizationPermissions: vi.fn().mockResolvedValue([]) } as never,
    { findAll: vi.fn().mockResolvedValue([]) } as never,
  );
  return { service, organizationRepository, apiKeyRepository };
}

describe('OrganizationApiKeyService lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('list', () => {
    it('throws NotFoundError when the organization is missing', async () => {
      const { service, organizationRepository } = buildService();
      organizationRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(service.list('org_public', {})).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns serialized items for the organization', async () => {
      const { service, apiKeyRepository } = buildService();
      const result = await service.list('org_public', {});
      expect(apiKeyRepository.findByOrganizationId).toHaveBeenCalledWith(ORG.id, expect.anything());
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ id: 'apikey_public' });
    });
  });

  describe('getByPublicId', () => {
    it('throws NotFoundError when the organization is missing', async () => {
      const { service, organizationRepository } = buildService();
      organizationRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(service.getByPublicId('org_public', 'apikey_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when the key is missing', async () => {
      const { service, apiKeyRepository } = buildService();
      apiKeyRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(service.getByPublicId('org_public', 'missing')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('returns the serialized key', async () => {
      const { service } = buildService();
      const result = await service.getByPublicId('org_public', 'apikey_public');
      expect(result).toMatchObject({ id: 'apikey_public' });
    });
  });

  describe('create', () => {
    const body = { name: 'CI Key', scopes: ['api-key:read'] };

    it('throws NotFoundError when the organization is missing', async () => {
      const { service, organizationRepository } = buildService();
      organizationRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(service.create('org_public', body, 'user_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('generates a one-time raw key, hashes it, and persists hash+prefix (no expiry by default)', async () => {
      const { service, apiKeyRepository } = buildService();
      const result = await service.create('org_public', body, 'user_public');

      expect(result.raw_key).toMatch(/^ak_[0-9a-f]+$/);
      const createArg = apiKeyRepository.create.mock.calls[0]![0] as Record<string, unknown>;
      expect(createArg.expires_at).toBeNull();
      // Persisted hash is the sha256 of the raw key, never the raw key itself.
      expect(createArg.key_hash).not.toBe(result.raw_key);
      expect(createArg.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.raw_key.startsWith(createArg.key_prefix as string)).toBe(true);
    });

    it('sets an expiry roughly expires_in_days in the future when provided', async () => {
      const { service, apiKeyRepository } = buildService();
      await service.create('org_public', { ...body, expires_in_days: 30 }, 'user_public');
      const createArg = apiKeyRepository.create.mock.calls[0]![0] as { expires_at: Date | null };
      expect(createArg.expires_at).toBeInstanceOf(Date);
      const daysOut = (createArg.expires_at!.getTime() - Date.now()) / 86_400_000;
      expect(daysOut).toBeGreaterThan(29);
      expect(daysOut).toBeLessThan(31);
    });
  });

  describe('update', () => {
    it('throws NotFoundError when the organization is missing', async () => {
      const { service, organizationRepository } = buildService();
      organizationRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(
        service.update('org_public', 'apikey_public', { name: 'X' }, 'user_public'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError when the key does not exist', async () => {
      const { service, apiKeyRepository } = buildService();
      apiKeyRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(
        service.update('org_public', 'missing', { name: 'X' }, 'user_public'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError when the update writes no row', async () => {
      const { service, apiKeyRepository } = buildService();
      apiKeyRepository.update.mockResolvedValueOnce(null);
      await expect(
        service.update('org_public', 'apikey_public', { name: 'X' }, 'user_public'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the serialized updated key', async () => {
      const { service } = buildService();
      const result = await service.update('org_public', 'apikey_public', { name: 'X' }, 'user_pub');
      expect(result).toMatchObject({ name: 'Renamed' });
    });
  });

  describe('delete', () => {
    it('throws NotFoundError when the organization is missing', async () => {
      const { service, organizationRepository } = buildService();
      organizationRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(service.delete('org_public', 'apikey_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when the soft-delete matches no row', async () => {
      const { service, apiKeyRepository } = buildService();
      apiKeyRepository.softDelete.mockResolvedValueOnce(null);
      await expect(service.delete('org_public', 'apikey_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('soft-deletes the key', async () => {
      const { service, apiKeyRepository } = buildService();
      await expect(service.delete('org_public', 'apikey_public')).resolves.toBeUndefined();
      expect(apiKeyRepository.softDelete).toHaveBeenCalledWith('apikey_public', ORG.id);
    });
  });

  describe('rotate', () => {
    it('throws NotFoundError when the organization is missing', async () => {
      const { service, organizationRepository } = buildService();
      organizationRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(
        service.rotate('org_public', 'apikey_public', 'user_public'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError when the key to rotate is missing', async () => {
      const { service, apiKeyRepository } = buildService();
      apiKeyRepository.findByPublicId.mockResolvedValueOnce(null);
      await expect(service.rotate('org_public', 'missing', 'user_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws ConflictError when a concurrent rotate already retired the key', async () => {
      const { service, apiKeyRepository } = buildService();
      apiKeyRepository.softDelete.mockResolvedValueOnce(null);
      await expect(
        service.rotate('org_public', 'apikey_public', 'user_public'),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(apiKeyRepository.create).not.toHaveBeenCalled();
    });

    it('retires the old key and mints exactly one replacement', async () => {
      const { service, apiKeyRepository } = buildService();
      const result = await service.rotate('org_public', 'apikey_public', 'user_public');
      expect(apiKeyRepository.softDelete).toHaveBeenCalledWith('apikey_public', ORG.id);
      expect(apiKeyRepository.create).toHaveBeenCalledTimes(1);
      expect(result.raw_key).toMatch(/^ak_/);
    });
  });
});
