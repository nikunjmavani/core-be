import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { UserNotificationPreferencesRepository } from '@/domains/user/sub-domains/user-notification-preferences/user-notification-preferences.repository.js';

describe('UserNotificationPreferencesRepository (database)', () => {
  const repository = new UserNotificationPreferencesRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('lists and replaces notification preferences for user', async () => {
    const user = await createTestUser();

    const initial = await repository.listByUserId(user.id);
    expect(initial).toHaveLength(0);

    const inserted = await repository.replaceAll(
      user.id,
      [
        {
          notification_type: 'SUBSCRIPTION_UPDATED',
          channel: 'EMAIL',
          organization_id: null,
          is_enabled: true,
        },
        {
          notification_type: 'INVITATION',
          channel: 'IN_APP',
          organization_id: null,
          is_enabled: false,
        },
      ],
      user.id,
    );
    expect(inserted).toHaveLength(2);

    const listed = await repository.listByUserId(user.id);
    expect(listed).toHaveLength(2);

    const replaced = await repository.replaceAll(user.id, [
      {
        notification_type: 'SUBSCRIPTION_UPDATED',
        channel: 'EMAIL',
        organization_id: null,
        is_enabled: false,
      },
    ]);
    expect(replaced).toHaveLength(1);

    const cleared = await repository.replaceAll(user.id, []);
    expect(cleared).toHaveLength(0);
  });
});
