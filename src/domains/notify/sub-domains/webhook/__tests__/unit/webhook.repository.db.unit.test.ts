import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { WebhookRepository } from '@/domains/notify/sub-domains/webhook/webhook.repository.js';

describe('WebhookRepository (database)', () => {
  const repository = new WebhookRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('creates, finds, updates, and soft-deletes webhooks', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });

    const created = await repository.create({
      organization_id: organization.id,
      url: 'https://example.com/hook',
      encrypted_secret: 'secret',
      events: ['subscription.updated'],
      is_enabled: true,
      created_by_user_id: user.id,
    });

    const found = await repository.findByPublicId(created.public_id, organization.id);
    expect(found?.url).toBe('https://example.com/hook');

    const listed = await repository.listByOrganization(organization.id);
    expect(listed.length).toBeGreaterThanOrEqual(1);

    const updated = await repository.update(
      created.public_id,
      organization.id,
      { url: 'https://example.com/updated', is_enabled: false },
      user.id,
    );
    expect(updated?.is_enabled).toBe(false);

    const deleted = await repository.softDelete(created.public_id, organization.id);
    expect(deleted?.deleted_at).not.toBeNull();

    const subscribed = await repository.listEnabledSubscribedToEvent(
      organization.id,
      'subscription.updated',
    );
    expect(subscribed).toHaveLength(0);
  });

  it('listEnabledSubscribedToEvent returns enabled webhooks for event', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    await repository.create({
      organization_id: organization.id,
      url: 'https://example.com/subscribed',
      encrypted_secret: 'secret',
      events: ['subscription.updated'],
      is_enabled: true,
      created_by_user_id: user.id,
    });

    const subscribed = await repository.listEnabledSubscribedToEvent(
      organization.id,
      'subscription.updated',
    );
    expect(subscribed.length).toBeGreaterThanOrEqual(1);
    expect(subscribed[0]?.url).toBe('https://example.com/subscribed');
  });
});
