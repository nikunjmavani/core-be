import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ValidationError } from '@/shared/errors/index.js';
import { PUBLIC_ID_REGEX } from '@/shared/utils/identity/public-id.util.js';

const ORGANIZATION_PATH_PUBLIC_ID_PATTERN = /\/organizations\/([A-Za-z0-9_-]{21})(?:\/|$)/;

/**
 * Extracts a 21-char NanoID-shaped organization public id from `/organizations/:id/...`
 * route paths. Returned value is used as a fallback when the `X-Organization-Id` header
 * is missing and as a consistency check when both header and path are present (mismatch
 * is rejected to prevent permission/RLS-GUC divergence).
 */
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
 *
 * @remarks
 * **sec-M7 foot-gun**: `request.organizationId` is set on the **`onRequest`**
 * hook — BEFORE authentication runs. The value comes from
 * attacker-controllable inputs (`X-Organization-Id` header, URL path) and is
 * NOT a proof of membership. The membership check happens later in
 * `requireOrganizationPermission`. Downstream middlewares MUST NOT trust
 * this field pre-auth — any DB lookup / cache key / RLS GUC keyed on it
 * before authentication is an enumeration / amplification vector
 * (see sec-M1 for an active exploitation of the same pattern).
 *
 * If your middleware or handler needs an organization id that is guaranteed
 * to have been authenticated, use {@link getAuthorizedOrganizationId} —
 * it asserts that `request.auth` has been populated by `app.authenticate`
 * before returning the value.
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

/**
 * sec-M7: typed accessor that returns `request.organizationId` ONLY when
 * `request.auth` has been populated by `app.authenticate`. Use this in any
 * downstream middleware / handler that needs an organization id whose
 * membership has been validated.
 *
 * Returns `null` when:
 * - `request.organizationId` was never set (no header / no path match), OR
 * - `request.auth` is not present (caller still on the pre-auth surface).
 *
 * Does NOT perform a membership check by itself — that remains
 * `requireOrganizationPermission`'s job. The only invariant enforced here
 * is "auth has run for this request", which is enough to block the
 * pre-auth amplification class of bugs.
 */
export function getAuthorizedOrganizationId(request: FastifyRequest): string | null {
  const requestWithOrganization = request as FastifyRequest & {
    organizationId?: string | null;
    auth?: unknown;
  };
  if (!requestWithOrganization.auth) {
    return null;
  }
  return requestWithOrganization.organizationId ?? null;
}

export default fp(tenantMiddleware, { name: 'tenant-middleware' });
