import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserSettingsRepository } from '@/domains/user/sub-domains/user-settings/user-settings.repository.js';

const mockReturning = vi.fn().mockResolvedValue([]);
const mockLimit = vi.fn().mockResolvedValue([]);
const mockWhere = vi.fn(() => ({ limit: mockLimit, returning: mockReturning }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

vi.mock('@/infrastructure/database/contexts/request-database.context.js', () => ({
  getRequestDatabase: () => ({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  }),
}));

describe('UserSettingsRepository', () => {
  const repository = new UserSettingsRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockReset();
    mockReturning.mockReset();
  });

  it('getByUserId returns settings row', async () => {
    const settings = { user_id: 1, language: 'en' };
    mockLimit.mockResolvedValue([settings]);

    const result = await repository.getByUserId(1);

    expect(result).toEqual(settings);
  });

  it('getByUserId returns null when no row exists', async () => {
    mockLimit.mockResolvedValue([]);
    expect(await repository.getByUserId(999)).toBeNull();
  });

  it('upsert inserts when no existing row', async () => {
    mockLimit.mockResolvedValue([]);
    const created = { user_id: 1, language: 'es' };
    mockReturning.mockResolvedValue([created]);

    const result = await repository.upsert(1, { language: 'es' });

    expect(mockInsert).toHaveBeenCalled();
    expect(result).toEqual(created);
  });

  it('upsert updates when row exists', async () => {
    const existing = {
      user_id: 1,
      language: 'en',
      is_dark_mode_enabled: false,
      is_notifications_enabled: true,
      preferred_locales: ['en'],
    };
    mockLimit.mockResolvedValue([existing]);
    const updated = { ...existing, language: 'fr' };
    mockReturning.mockResolvedValue([updated]);

    const result = await repository.upsert(1, { language: 'fr' });

    expect(mockUpdate).toHaveBeenCalled();
    expect(result.language).toBe('fr');
  });

  it('upsert applies defaults on insert when optional fields are omitted', async () => {
    mockLimit.mockResolvedValue([]);
    const created = {
      user_id: 2,
      language: 'en',
      is_dark_mode_enabled: false,
      is_notifications_enabled: true,
      preferred_locales: ['en'],
    };
    mockReturning.mockResolvedValue([created]);

    const result = await repository.upsert(2, {});

    expect(mockInsert).toHaveBeenCalled();
    expect(result.is_dark_mode_enabled).toBe(false);
    expect(result.is_notifications_enabled).toBe(true);
    expect(result.preferred_locales).toEqual(['en']);
  });

  it('upsert uses defaults when existing row omits optional locale fields', async () => {
    const existing = {
      user_id: 4,
      language: 'en',
      is_dark_mode_enabled: false,
      is_notifications_enabled: true,
      preferred_locales: undefined,
    };
    mockLimit.mockResolvedValue([existing]);
    mockReturning.mockResolvedValue([
      { ...existing, preferred_locales: ['en'], is_dark_mode_enabled: false },
    ]);

    const result = await repository.upsert(4, { language: 'en' });

    expect(mockUpdate).toHaveBeenCalled();
    expect(result.preferred_locales).toEqual(['en']);
  });

  it('upsert preserves existing toggles when partial update omits them', async () => {
    const existing = {
      user_id: 3,
      language: 'de',
      is_dark_mode_enabled: true,
      is_notifications_enabled: false,
      preferred_locales: ['de', 'en'],
    };
    mockLimit.mockResolvedValue([existing]);
    mockReturning.mockResolvedValue([{ ...existing, preferred_locales: ['de'] }]);

    const result = await repository.upsert(3, { preferred_locales: ['de'] });

    expect(mockUpdate).toHaveBeenCalled();
    expect(result.is_dark_mode_enabled).toBe(true);
    expect(result.is_notifications_enabled).toBe(false);
    expect(result.preferred_locales).toEqual(['de']);
  });
});
