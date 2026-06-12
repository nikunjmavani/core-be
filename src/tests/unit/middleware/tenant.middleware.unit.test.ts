import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import tenantMiddleware from '@/shared/middlewares/tenant/tenant.middleware.js';

async function createTenantApp() {
  const application = Fastify();
  await application.register(tenantMiddleware);
  application.get('/probe', async (request) => ({
    organizationId: request.organizationId,
  }));
  application.get(
    '/api/v1/tenancy/organizations/:organization_id/memberships',
    async (request) => ({
      organizationId: request.organizationId,
    }),
  );
  application.get('/api/v1/tenancy/organizations/:organization_id/settings', async (request) => ({
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

  it('infers organizationId from /organizations/:organization_id/ URL when header is absent', async () => {
    application = await createTenantApp();
    const organizationPublicId = generatePublicId('organization');

    const response = await application.inject({
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${organizationPublicId}/memberships`),
    });

    expect(response.json()).toEqual({ organizationId: organizationPublicId });
  });

  it('returns 400 when header and path organization ids differ', async () => {
    application = await createTenantApp();
    const headerOrganizationId = generatePublicId('organization');
    const pathOrganizationId = generatePublicId('organization');

    const response = await application.inject({
      method: 'GET',
      url: testApiPath(`/tenancy/organizations/${pathOrganizationId}/settings`),
      headers: { 'x-organization-id': headerOrganizationId },
    });

    expect(response.statusCode).toBe(400);
  });
});
