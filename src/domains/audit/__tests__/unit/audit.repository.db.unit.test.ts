import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { AuditRepository } from '@/domains/audit/audit.repository.js';

describe('AuditRepository (database)', () => {
  const repository = new AuditRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('creates and lists audit logs with filters', async () => {
    const actor = await createTestUser({ email: 'audit-actor@example.com' });

    await repository.insert({
      actor_user_id: actor.id,
      action: 'user.login',
      resource_type: 'user',
      resource_id: actor.id,
      metadata: { ip: '127.0.0.1' },
    });

    const listed = await repository.findWithFilters({
      limit: 20,
      actor_user_id: actor.id,
    });
    expect(listed.items.length).toBeGreaterThanOrEqual(1);
    expect(listed.items[0]?.action).toBe('user.login');
  });

  it('findWithFilters applies optional filters and findRecent returns latest rows', async () => {
    const actor = await createTestUser({ email: 'audit-filter@example.com' });

    await repository.insert({
      actor_user_id: actor.id,
      action: 'organization.updated',
      resource_type: 'organization',
      resource_id: 1,
      severity: 'WARNING',
    });

    const filtered = await repository.findWithFilters({
      limit: 10,
      actor_user_id: actor.id,
      resource_type: 'organization',
      action: 'organization.updated',
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(filtered.items.some((row) => row.action === 'organization.updated')).toBe(true);

    const recent = await repository.findRecent(5);
    expect(recent.length).toBeGreaterThanOrEqual(1);
  });

  it('findWithFilters supports organization_id and unfiltered pagination', async () => {
    const actor = await createTestUser({ email: 'audit-org@example.com' });
    const organization = await createTestOrganization({ ownerUserId: actor.id });

    await repository.insert({
      organization_id: organization.id,
      actor_user_id: actor.id,
      action: 'organization.viewed',
      resource_type: 'organization',
      resource_id: organization.id,
    });

    const byOrganization = await repository.findWithFilters({
      limit: 10,
      organization_id: organization.id,
    });
    expect(byOrganization.items.some((row) => row.action === 'organization.viewed')).toBe(true);

    const unfiltered = await repository.findWithFilters({ limit: 5 });
    expect(unfiltered.items.length).toBeGreaterThanOrEqual(1);
  });

  it('findWithFilters ignores null optional filters', async () => {
    const actor = await createTestUser({ email: 'audit-null-filters@example.com' });
    await repository.insert({
      actor_user_id: actor.id,
      action: 'user.viewed',
      resource_type: 'user',
      resource_id: actor.id,
    });

    const listed = await repository.findWithFilters({
      limit: 10,
      organization_id: null,
      actor_user_id: null,
      resource_type: null,
      action: null,
      from: null,
      to: null,
    } as never);

    expect(listed.items.some((row) => row.action === 'user.viewed')).toBe(true);
  });
});
