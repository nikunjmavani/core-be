import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import tenantMiddleware from '@/shared/middlewares/tenant/tenant.middleware.js';

async function createTenantApp() {
  const application = Fastify();
  await application.register(tenantMiddleware);
  application.get('/probe', async (request) => ({
    organizationId: request.organizationId,
  }));
  await application.ready();
  return application;
}

describe('tenant.middleware', () => {
  let application: Awaited<ReturnType<typeof createTenantApp>>;

  afterEach(async () => {
    if (application) {
      await application.close();
    }
  });

  it('sets organizationId from valid X-Organization-Id header', async () => {
    application = await createTenantApp();
    const organizationPublicId = generatePublicId('organization');

    const response = await application.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-organization-id': organizationPublicId },
    });

    expect(response.json()).toEqual({ organizationId: organizationPublicId });
  });

  it('ignores invalid X-Organization-Id header format', async () => {
    application = await createTenantApp();

    const response = await application.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-organization-id': 'not-a-valid-public-id-format' },
    });

    expect(response.json()).toEqual({ organizationId: null });
  });

  it('leaves organizationId null when no header is present', async () => {
    application = await createTenantApp();

    const response = await application.inject({ method: 'GET', url: '/probe' });

    // The active organization now comes from the signed `org` token claim, not the URL —
    // routes no longer carry an `{organization_id}` path segment for the middleware to parse.
    expect(response.json()).toEqual({ organizationId: null });
  });
});
