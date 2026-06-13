import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { PUBLIC_ID_REGEX } from '@/shared/utils/identity/public-id.util.js';

/**
 * Tenant middleware: reads the `X-Organization-Id` header and attaches
 * `request.organizationId`. Validates the format to prevent injection attacks.
 *
 * @remarks
 * The active organization for organization-scoped routes now flows from the
 * signed `org` JWT claim (resolved post-auth by `resolveActiveOrganizationId` /
 * `requireOrganizationPermission`), NOT from the URL — routes no longer carry an
 * `{organization_id}` path segment. This header remains the org source only for
 * the few consumers that read `request.organizationId` directly (e.g. the upload
 * domain); it is not the authority for permission checks or the RLS GUC.
 *
 * Row-Level Security for Postgres uses `SET LOCAL app.current_organization_id`
 * inside the short-lived `withOrganizationDatabaseContext` transaction opened at
 * each org-scoped call site, keyed by the claim-resolved organization id.
 *
 * **sec-M7 foot-gun**: `request.organizationId` is set on the **`onRequest`**
 * hook — BEFORE authentication runs. The value comes from an
 * attacker-controllable input (the `X-Organization-Id` header) and is NOT a
 * proof of membership. The membership check happens later in
 * `requireOrganizationPermission` (against the token claim). Downstream
 * middlewares MUST NOT trust this field pre-auth — any DB lookup / cache key /
 * RLS GUC keyed on it before authentication is an enumeration / amplification
 * vector (see sec-M1 for an active exploitation of the same pattern).
 */
const tenantMiddleware: FastifyPluginAsync = async (app) => {
  app.decorateRequest('organizationId', null);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const requestWithOrganization = request as FastifyRequest & {
      organizationId: string | null;
    };

    const headerValue = request.headers['x-organization-id'];
    if (
      typeof headerValue === 'string' &&
      headerValue.length > 0 &&
      PUBLIC_ID_REGEX.test(headerValue)
    ) {
      requestWithOrganization.organizationId = headerValue;
    }
  });
};

export default fp(tenantMiddleware, { name: 'tenant-middleware' });
