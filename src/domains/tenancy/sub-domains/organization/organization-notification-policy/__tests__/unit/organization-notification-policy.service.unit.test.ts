import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

import { NotFoundError } from '@/shared/errors/index.js';
import { OrganizationNotificationPolicyService } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.service.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { OrganizationNotificationPolicyRepository } from '@/domains/tenancy/sub-domains/organization/organization-notification-policy/organization-notification-policy.repository.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const organization = { id: 1, public_id: 'org_public_abc', name: 'Test Org' };
const policyRow = {
  id: 1,
  public_id: 'pol_public_1',
  organization_id: 1,
  notification_type: 'invite',
  channel: 'EMAIL',
  default_enabled: true,
  is_mandatory: false,
  muted_until: null,
  created_at: now,
  updated_at: now,
};

describe('OrganizationNotificationPolicyService', () => {
  const organizationRepository = {
    findByPublicId: vi.fn().mockResolvedValue(organization),
    resolveUserIdByPublicId: vi.fn().mockResolvedValue(10),
  } as unknown as OrganizationRepository;

  const policyRepository = {
    findByOrganizationId: vi.fn().mockResolvedValue([policyRow]),
    findByPublicId: vi.fn().mockResolvedValue(policyRow),
    // sec-r5-followup-ratelimit-dos-3: create() now consults this guard
    // before insert. Default to 0 so existing tests still reach create;
    // the cap regression lives in `per-org-row-caps.unit.test.ts`.
    countActiveByOrganization: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue(policyRow),
    update: vi.fn().mockResolvedValue(policyRow),
    softDelete: vi.fn().mockResolvedValue(policyRow),
  } as unknown as OrganizationNotificationPolicyRepository;

  const service = new OrganizationNotificationPolicyService(
    organizationRepository,
    policyRepository,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(organization as never);
    vi.mocked(policyRepository.findByOrganizationId).mockResolvedValue([policyRow] as never);
    vi.mocked(policyRepository.findByPublicId).mockResolvedValue(policyRow as never);
    vi.mocked(policyRepository.create).mockResolvedValue(policyRow as never);
    vi.mocked(policyRepository.update).mockResolvedValue(policyRow as never);
    vi.mocked(policyRepository.softDelete).mockResolvedValue(policyRow as never);
    vi.mocked(organizationRepository.resolveUserIdByPublicId).mockResolvedValue(10);
  });

  describe('list', () => {
    it('returns serialized policies for an organization', async () => {
      const result = await service.list('org_public_abc');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        organization_id: 'org_public_abc',
        notification_type: 'invite',
        channel: 'EMAIL',
      });
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.list('org_public_abc')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns empty array when no policies exist', async () => {
      vi.mocked(policyRepository.findByOrganizationId).mockResolvedValue([]);
      const result = await service.list('org_public_abc');
      expect(result).toHaveLength(0);
    });
  });

  describe('getById', () => {
    it('returns serialized policy when found', async () => {
      const result = await service.getByPublicId('org_public_abc', 'pol_public_1');
      expect(result).toMatchObject({ id: policyRow.public_id, organization_id: 'org_public_abc' });
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.getByPublicId('org_public_abc', 'pol_public_1')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when policy is missing', async () => {
      vi.mocked(policyRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.getByPublicId('org_public_abc', 'pol_public_1')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('create', () => {
    const body = {
      notification_type: 'invite',
      channel: 'EMAIL',
      default_enabled: true,
      is_mandatory: false,
    };

    it('creates and returns serialized policy', async () => {
      const result = await service.create('org_public_abc', body, 'user_public');
      expect(policyRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: organization.id,
          notification_type: 'invite',
          channel: 'EMAIL',
        }),
      );
      expect(result).toMatchObject({ organization_id: 'org_public_abc' });
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.create('org_public_abc', body, 'user_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('propagates repository create errors', async () => {
      vi.mocked(policyRepository.create).mockRejectedValue(new Error('Unique constraint'));
      await expect(service.create('org_public_abc', body, 'user_public')).rejects.toThrow(
        'Unique constraint',
      );
    });
  });

  describe('update', () => {
    it('updates and returns serialized policy', async () => {
      const result = await service.update(
        'org_public_abc',
        'pol_public_1',
        { default_enabled: false },
        'user_public',
      );
      expect(policyRepository.update).toHaveBeenCalled();
      expect(result).toMatchObject({ organization_id: 'org_public_abc' });
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(
        service.update('org_public_abc', 'pol_public_1', { default_enabled: false }, 'user_public'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws NotFoundError when policy update returns null', async () => {
      vi.mocked(policyRepository.update).mockResolvedValue(null);
      await expect(
        service.update('org_public_abc', 'pol_public_1', { default_enabled: false }, 'user_public'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('delete', () => {
    it('soft-deletes the policy when found', async () => {
      await service.delete('org_public_abc', 'pol_public_1');
      expect(policyRepository.softDelete).toHaveBeenCalledWith('pol_public_1', organization.id);
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.delete('org_public_abc', 'pol_public_1')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('throws NotFoundError when policy is not found for deletion', async () => {
      vi.mocked(policyRepository.softDelete).mockResolvedValue(null);
      await expect(service.delete('org_public_abc', 'pol_public_1')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
});
