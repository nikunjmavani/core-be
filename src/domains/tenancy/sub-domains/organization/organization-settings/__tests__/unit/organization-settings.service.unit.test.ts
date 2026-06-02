import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infrastructure/database/contexts/organization-database.context.js', () => ({
  withOrganizationDatabaseContext: vi.fn(
    async (_organizationPublicId: string, callback: () => Promise<unknown>) => callback(),
  ),
}));

import { NotFoundError } from '@/shared/errors/index.js';
import { OrganizationSettingsService } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.service.js';
import type { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';
import type { OrganizationSettingsRepository } from '@/domains/tenancy/sub-domains/organization/organization-settings/organization-settings.repository.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const organization = { id: 1, public_id: 'org_public_abc', name: 'Test Org' };
const settingsRow = {
  is_email_notifications_enabled: true,
  default_locale: 'en',
  security_policy: {},
  created_at: now,
  updated_at: now,
};

describe('OrganizationSettingsService', () => {
  const organizationRepository = {
    findByPublicId: vi.fn().mockResolvedValue(organization),
    resolveUserIdByPublicId: vi.fn().mockResolvedValue(10),
  } as unknown as OrganizationRepository;

  const settingsRepository = {
    findByOrganizationId: vi.fn().mockResolvedValue(settingsRow),
    upsert: vi.fn().mockResolvedValue(settingsRow),
    findDefaultLocaleByOrganizationPublicId: vi.fn().mockResolvedValue('en'),
    userHasOrganizationRequiringMfa: vi.fn().mockResolvedValue(false),
  } as unknown as OrganizationSettingsRepository;

  const service = new OrganizationSettingsService(organizationRepository, settingsRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(organization as never);
    vi.mocked(settingsRepository.findByOrganizationId).mockResolvedValue(settingsRow as never);
    vi.mocked(settingsRepository.upsert).mockResolvedValue(settingsRow as never);
    vi.mocked(settingsRepository.findDefaultLocaleByOrganizationPublicId).mockResolvedValue('en');
    vi.mocked(settingsRepository.userHasOrganizationRequiringMfa).mockResolvedValue(false);
  });

  describe('get', () => {
    it('returns serialized settings when row exists', async () => {
      const result = await service.get('org_public_abc');
      expect(result).toMatchObject({
        organization_id: 'org_public_abc',
        is_email_notifications_enabled: true,
        default_locale: 'en',
      });
    });

    it('upserts and returns defaults when settings row is missing', async () => {
      vi.mocked(settingsRepository.findByOrganizationId).mockResolvedValue(null);
      await service.get('org_public_abc');
      expect(settingsRepository.upsert).toHaveBeenCalledWith(organization.id, {});
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.get('org_public_abc')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('propagates repository errors', async () => {
      vi.mocked(settingsRepository.findByOrganizationId).mockRejectedValue(
        new Error('DB connection failed'),
      );
      await expect(service.get('org_public_abc')).rejects.toThrow('DB connection failed');
    });
  });

  describe('update', () => {
    it('validates and upserts settings with provided fields', async () => {
      const result = await service.update(
        'org_public_abc',
        { is_email_notifications_enabled: false },
        'user_public',
      );
      expect(settingsRepository.upsert).toHaveBeenCalledWith(
        organization.id,
        expect.objectContaining({ is_email_notifications_enabled: false }),
      );
      expect(result).toMatchObject({ organization_id: 'org_public_abc' });
    });

    it('throws NotFoundError when organization is missing', async () => {
      vi.mocked(organizationRepository.findByPublicId).mockResolvedValue(null);
      await expect(service.update('org_public_abc', {}, 'user_public')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('propagates upsert errors', async () => {
      vi.mocked(settingsRepository.upsert).mockRejectedValue(new Error('Upsert failed'));
      await expect(service.update('org_public_abc', {}, 'user_public')).rejects.toThrow(
        'Upsert failed',
      );
    });
  });

  describe('resolveDefaultLocaleForOrganization', () => {
    it('returns configured locale when set', async () => {
      const locale = await service.resolveDefaultLocaleForOrganization('org_public_abc');
      expect(locale).toBe('en');
    });

    it('falls back to "en" when locale is null', async () => {
      vi.mocked(settingsRepository.findDefaultLocaleByOrganizationPublicId).mockResolvedValue(null);
      const locale = await service.resolveDefaultLocaleForOrganization('org_public_abc');
      expect(locale).toBe('en');
    });
  });

  describe('userHasOrganizationRequiringMfa', () => {
    it('delegates to repository and returns boolean', async () => {
      vi.mocked(settingsRepository.userHasOrganizationRequiringMfa).mockResolvedValue(true);
      const result = await service.userHasOrganizationRequiringMfa(1);
      expect(result).toBe(true);
      expect(settingsRepository.userHasOrganizationRequiringMfa).toHaveBeenCalledWith(1);
    });

    it('returns false when no org requires MFA', async () => {
      const result = await service.userHasOrganizationRequiringMfa(1);
      expect(result).toBe(false);
    });
  });
});
