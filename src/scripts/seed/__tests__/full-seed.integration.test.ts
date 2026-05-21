import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { runFullSeed } from '@/scripts/seed/full.js';
import { getRequestDatabase } from '@/infrastructure/database/contexts/request-database.context.js';
import { subscriptions } from '@/domains/billing/sub-domains/subscription/subscription.schema.js';
import { notifications } from '@/domains/notify/sub-domains/notification/notification.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { users } from '@/domains/user/user.schema.js';

const DEMO_TEST_PASSWORD = 'DemoPassword123!';
const DEMO_EMAIL = 'demo@example.com';
const DEMO_ORGANIZATION_SLUG = 'demo-org';

async function resolveDemoSeedPublicIds(): Promise<{
  demoUserPublicId: string;
  demoOrganizationPublicId: string;
}> {
  const database = getRequestDatabase();
  const [user] = await database
    .select({ public_id: users.public_id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL))
    .limit(1);
  const [organization] = await database
    .select({ public_id: organizations.public_id })
    .from(organizations)
    .where(eq(organizations.slug, DEMO_ORGANIZATION_SLUG))
    .limit(1);
  if (!user || !organization) {
    throw new Error('full-seed.integration: demo user or organization not found after seed');
  }
  return {
    demoUserPublicId: user.public_id,
    demoOrganizationPublicId: organization.public_id,
  };
}

describe('Full seed — integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    process.env.TEST_PASSWORD = DEMO_TEST_PASSWORD;
  });

  it('should not duplicate demo billing rows when runFullSeed is called twice', async () => {
    await runFullSeed();
    const firstRun = await resolveDemoSeedPublicIds();
    await runFullSeed();
    const secondRun = await resolveDemoSeedPublicIds();

    expect(secondRun.demoOrganizationPublicId).toBe(firstRun.demoOrganizationPublicId);
    expect(secondRun.demoUserPublicId).toBe(firstRun.demoUserPublicId);

    const database = getRequestDatabase();
    const [organization] = await database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.public_id, firstRun.demoOrganizationPublicId))
      .limit(1);
    expect(organization).toBeDefined();

    const [subscriptionCount] = await database
      .select({ total: count() })
      .from(subscriptions)
      .where(eq(subscriptions.organization_id, organization!.id));

    expect(subscriptionCount?.total).toBe(1);
  });

  it('should seed at least five notifications with unread count after runFullSeed', async () => {
    await runFullSeed();
    const { demoUserPublicId, demoOrganizationPublicId } = await resolveDemoSeedPublicIds();
    const token = await generateTestToken({ userId: demoUserPublicId });

    const listResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/notify/notifications'),
      token,
      organizationPublicId: demoOrganizationPublicId,
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json() as { data?: unknown[] };
    expect(listBody.data?.length).toBeGreaterThanOrEqual(5);

    const unreadResponse = await injectAuthenticated(app, {
      method: 'GET',
      url: testApiPath('/notify/notifications/unread-count'),
      token,
      organizationPublicId: demoOrganizationPublicId,
    });
    expect(unreadResponse.statusCode).toBe(200);
    const unreadBody = unreadResponse.json() as { data?: { count?: number } };
    expect(unreadBody.data?.count).toBeGreaterThan(0);

    const database = getRequestDatabase();
    const [organization] = await database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.public_id, demoOrganizationPublicId))
      .limit(1);
    const [notificationCount] = await database
      .select({ total: count() })
      .from(notifications)
      .where(eq(notifications.organization_id, organization!.id));

    expect(notificationCount?.total).toBeGreaterThanOrEqual(5);
  });
});
