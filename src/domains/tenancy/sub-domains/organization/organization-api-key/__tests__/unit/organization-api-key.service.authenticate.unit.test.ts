import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrganizationApiKeyService } from '@/domains/tenancy/sub-domains/organization/organization-api-key/organization-api-key.service.js';

describe('OrganizationApiKeyService.authenticate', () => {
  const organizationRepository = {
    findById: vi.fn(),
  };

  const apiKeyRepository = {
    findActiveByKeyPrefix: vi.fn(),
    touchLastUsedAt: vi.fn().mockResolvedValue(undefined),
  };

  const service = new OrganizationApiKeyService(
    organizationRepository as never,
    apiKeyRepository as never,
  );

  const activeRow = {
    public_id: 'apikey_public_abc',
    organization_id: 1,
    key_hash: 'stored-hash',
    key_prefix: 'ak_prefix',
    scopes: ['read'],
    expires_at: null,
    status: 'ACTIVE',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationRepository.findById).mockResolvedValue({
      id: 1,
      public_id: 'org_public_abc',
    } as never);
  });

  it('returns auth match for valid prefix + hash and touches last_used_at', async () => {
    vi.mocked(apiKeyRepository.findActiveByKeyPrefix).mockResolvedValue([activeRow] as never);
    const hashCompare = vi.fn().mockReturnValue(true);

    const result = await service.authenticate('ak_prefix', 'candidate-hash', hashCompare);

    expect(result).toEqual({
      public_id: 'apikey_public_abc',
      organization_public_id: 'org_public_abc',
      scopes: ['read'],
    });
    expect(hashCompare).toHaveBeenCalledWith('stored-hash', 'candidate-hash');
    expect(apiKeyRepository.touchLastUsedAt).toHaveBeenCalledWith('apikey_public_abc');
  });

  it('returns null when hash does not match any candidate', async () => {
    vi.mocked(apiKeyRepository.findActiveByKeyPrefix).mockResolvedValue([activeRow] as never);
    const result = await service.authenticate('ak_prefix', 'wrong-hash', () => false);
    expect(result).toBeNull();
    expect(apiKeyRepository.touchLastUsedAt).not.toHaveBeenCalled();
  });

  it('returns null for expired api key even when hash matches', async () => {
    vi.mocked(apiKeyRepository.findActiveByKeyPrefix).mockResolvedValue([
      { ...activeRow, expires_at: new Date(Date.now() - 60_000) },
    ] as never);
    const result = await service.authenticate('ak_prefix', 'candidate-hash', () => true);
    expect(result).toBeNull();
    expect(apiKeyRepository.touchLastUsedAt).not.toHaveBeenCalled();
  });

  it('returns null when no active candidates exist for prefix', async () => {
    vi.mocked(apiKeyRepository.findActiveByKeyPrefix).mockResolvedValue([]);
    const result = await service.authenticate('ak_unknown', 'hash', () => true);
    expect(result).toBeNull();
  });

  it('skips candidate when organization row is missing', async () => {
    vi.mocked(apiKeyRepository.findActiveByKeyPrefix).mockResolvedValue([activeRow] as never);
    vi.mocked(organizationRepository.findById).mockResolvedValue(null);
    const result = await service.authenticate('ak_prefix', 'candidate-hash', () => true);
    expect(result).toBeNull();
  });
});
