import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '@/shared/errors/index.js';
import { UserSettingsService } from '@/domains/user/sub-domains/user-settings/user-settings.service.js';
import type { UserService } from '@/domains/user/user.service.js';
import type { UserSettingsRepository } from '@/domains/user/sub-domains/user-settings/user-settings.repository.js';

const user = { id: 1, public_id: 'user_public' };
const settingsRow = {
  is_dark_mode_enabled: true,
  is_notifications_enabled: false,
  language: 'es',
  preferred_locales: ['es', 'en'],
};

describe('UserSettingsService', () => {
  const userService = {
    findUserRecordByPublicId: vi.fn().mockResolvedValue(user),
  } as unknown as UserService;

  const settingsRepository = {
    getByUserId: vi.fn().mockResolvedValue(settingsRow),
    upsert: vi.fn().mockResolvedValue(settingsRow),
  } as unknown as UserSettingsRepository;

  const service = new UserSettingsService(userService, settingsRepository);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(user as never);
  });

  it('get returns stored settings', async () => {
    const result = await service.get('user_public');
    expect(result.language).toBe('es');
    expect(result.is_dark_mode_enabled).toBe(true);
  });

  it('get returns defaults when no settings row exists', async () => {
    vi.mocked(settingsRepository.getByUserId).mockResolvedValue(null);
    const result = await service.get('user_public');
    expect(result).toEqual({
      is_dark_mode_enabled: false,
      is_notifications_enabled: true,
      language: 'en',
      preferred_locales: ['en'],
    });
  });

  it('get throws when user is missing', async () => {
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('update upserts settings for user', async () => {
    const result = await service.update('user_public', { language: 'fr' });
    expect(settingsRepository.upsert).toHaveBeenCalledWith(1, { language: 'fr' });
    expect(result.language).toBe('es');
  });

  it('update throws when user is missing', async () => {
    vi.mocked(userService.findUserRecordByPublicId).mockResolvedValue(null);
    await expect(service.update('missing', { language: 'de' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
