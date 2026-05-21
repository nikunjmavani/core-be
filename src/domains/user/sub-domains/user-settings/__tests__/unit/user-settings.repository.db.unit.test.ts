import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { UserSettingsRepository } from '@/domains/user/sub-domains/user-settings/user-settings.repository.js';

describe('UserSettingsRepository (database)', () => {
  const repository = new UserSettingsRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('getByUserId returns null when settings missing', async () => {
    const user = await createTestUser();
    const row = await repository.getByUserId(user.id);
    expect(row).toBeNull();
  });
});
