import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ValidationError } from '@/shared/errors/index.js';
import { PUBLIC_ID_REGEX } from '@/shared/utils/identity/public-id.util.js';

const ORGANIZATION_PATH_PUBLIC_ID_PATTERN = /\/organizations\/([A-Za-z0-9_-]{21})(?:\/|$)/;

export function parseOrganizationPublicIdFromUrl(url: string): string | null {
  const pathWithoutQuery = url.split('?')[0] ?? url;
  const match = ORGANIZATION_PATH_PUBLIC_ID_PATTERN.exec(pathWithoutQuery);
  if (!match?.[1]) {
    return null;
  }
  return match[1];
}

/**
 * Tenant middleware: reads X-Organization-Id header and attaches
 * request.organizationId for organization-scoped routes.
 * Validates the format to prevent injection attacks.
 *
 * When the header is absent, infers organization id from `/organizations/:id/` in the URL.
 * If header and path disagree, the request is rejected (prevents permission check on
 * one org while RLS GUC is set to another).
 *
 * Row-Level Security for Postgres uses `SET LOCAL app.current_organization_id` inside a
 * single request-scoped transaction — see `organization-rls-transaction.middleware.ts`.
 */
const tenantMiddleware: FastifyPluginAsync = async (app) => {
  app.decorateRequest('organizationId', null);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const requestWithOrganization = request as FastifyRequest & {
      organizationId: string | null;
    };

    const headerValue = request.headers['x-organization-id'];
    let headerOrganizationId: string | null = null;
    if (
      typeof headerValue === 'string' &&
      headerValue.length > 0 &&
      PUBLIC_ID_REGEX.test(headerValue)
    ) {
      headerOrganizationId = headerValue;
    }

    const pathOrganizationId = parseOrganizationPublicIdFromUrl(request.url);

    if (headerOrganizationId && pathOrganizationId && headerOrganizationId !== pathOrganizationId) {
      throw new ValidationError('errors:organizationHeaderPathMismatch');
    }

    if (headerOrganizationId) {
      requestWithOrganization.organizationId = headerOrganizationId;
    } else if (pathOrganizationId) {
      requestWithOrganization.organizationId = pathOrganizationId;
    }
  });
};

export default fp(tenantMiddleware, { name: 'tenant-middleware' });
