import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { WebhookRepository } from '@/domains/notify/sub-domains/webhook/webhook.repository.js';
import { webhooks } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 20_000 });

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

    const listed = await repository.listByOrganization(organization.id, { limit: 20 });
    expect(listed.items.length).toBeGreaterThanOrEqual(1);
    expect(listed.total).toBeNull();

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

  describe('listByOrganization (keyset cursor pagination)', () => {
    async function createWebhooks(organizationId: number, userId: number, count: number) {
      const baseCreatedAt = Date.now();
      for (let index = 0; index < count; index += 1) {
        const created = await repository.create({
          organization_id: organizationId,
          url: `https://example.com/hook-${index}-${baseCreatedAt}`,
          encrypted_secret: 'secret',
          events: ['subscription.updated'],
          is_enabled: true,
          created_by_user_id: userId,
        });
        const orderedCreatedAt = new Date(baseCreatedAt + index * 1_000);
        await database
          .update(webhooks)
          .set({ created_at: orderedCreatedAt, updated_at: orderedCreatedAt })
          .where(eq(webhooks.id, created.id));
      }
    }

    it('omits total by default, sets has_more=true, and returns opaque next_cursor when more pages exist', async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      await createWebhooks(organization.id, user.id, 3);

      const page1 = await repository.listByOrganization(organization.id, { limit: 2 });

      expect(page1.items).toHaveLength(2);
      expect(page1.has_more).toBe(true);
      expect(page1.next_cursor).toBeTypeOf('string');
      expect(page1.next_cursor).not.toBe('');
      expect(page1.total).toBeNull();
    });

    it('navigating with `after` returns the next batch and stops at the final page', async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      await createWebhooks(organization.id, user.id, 3);

      const page1 = await repository.listByOrganization(organization.id, { limit: 2 });
      expect(page1.has_more).toBe(true);
      expect(page1.next_cursor).toBeTypeOf('string');

      const page2 = await repository.listByOrganization(organization.id, {
        limit: 2,
        after: page1.next_cursor!,
      });

      const page1Ids = new Set(page1.items.map((item) => item.id));
      for (const item of page2.items) {
        expect(page1Ids.has(item.id)).toBe(false);
      }
      expect(page1.items.length + page2.items.length).toBe(3);
      expect(page2.has_more).toBe(false);
      expect(page2.next_cursor).toBeNull();
    });

    it('returns has_more=false and next_cursor=null when the page exactly fits the limit', async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      await createWebhooks(organization.id, user.id, 2);

      const result = await repository.listByOrganization(organization.id, { limit: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
    });

    it('returns empty result without total when no rows match', async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });

      const result = await repository.listByOrganization(organization.id, { limit: 10 });

      expect(result.items).toEqual([]);
      expect(result.has_more).toBe(false);
      expect(result.next_cursor).toBeNull();
      expect(result.total).toBeNull();
    });

    it('returns total when include_total=true is requested', async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      await createWebhooks(organization.id, user.id, 3);

      const result = await repository.listByOrganization(organization.id, {
        limit: 2,
        include_total: true,
      });

      expect(result.total).toBe(3);
      expect(result.items).toHaveLength(2);
      expect(result.has_more).toBe(true);
    });

    it('does not include soft-deleted webhooks in results or total', async () => {
      const user = await createTestUser();
      const organization = await createTestOrganization({ ownerUserId: user.id });
      await createWebhooks(organization.id, user.id, 2);

      const all = await repository.listByOrganization(organization.id, {
        limit: 10,
        include_total: true,
      });
      const firstPublicId = all.items[0]!.public_id;
      await repository.softDelete(firstPublicId, organization.id);

      const afterDelete = await repository.listByOrganization(organization.id, {
        limit: 10,
        include_total: true,
      });

      expect(afterDelete.items).toHaveLength(1);
      expect(afterDelete.total).toBe(1);
    });
  });
});
