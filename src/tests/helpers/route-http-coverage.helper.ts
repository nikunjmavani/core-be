import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getRoutesByDomain, type RouteEntry } from '@/tests/helpers/route-catalog-registry.js';
import {
  injectAuthenticated,
  injectUnauthenticated,
  type InjectHttpResult,
} from '@/tests/helpers/test-http-inject.helper.js';

export type RouteSmokeCase = {
  route: RouteEntry;
  materializedPath: string;
  expectUnauthenticated: number | number[];
  expectForbidden?: number;
  expectSuccess?: number;
};

const PATH_PARAM_PLACEHOLDER = '000000000000000000000';

export function loadRoutesForDomain(domain: string): RouteEntry[] {
  return getRoutesByDomain(domain);
}

export function materializeRoutePath(path: string, organizationPublicId: string): string {
  return path.replace(':id', organizationPublicId).replace(/:[a-zA-Z]+/g, PATH_PARAM_PLACEHOLDER);
}

export function buildRouteSmokeCases(
  route: RouteEntry,
  organizationPublicId: string,
): RouteSmokeCase {
  const materializedPath = materializeRoutePath(route.path, organizationPublicId);

  switch (route.access) {
    case 'public': {
      const hasPathParam = route.path.includes(':');
      const expectUnauthenticated =
        hasPathParam && (route.method === 'GET' || route.method === 'DELETE')
          ? 404
          : hasPathParam
            ? 400
            : 200;
      return {
        route,
        materializedPath,
        expectUnauthenticated,
      };
    }
    case 'authenticated': {
      /**
       * Fastify runs schema validation before `preHandler`, so an authenticated POST/PUT/PATCH
       * with an empty payload may legitimately respond 400 (body fails Zod) before the auth
       * preHandler asserts 401. Accept both for smoke coverage.
       */
      const unauthenticatedStatus =
        route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH'
          ? [400, 401, 422]
          : 401;
      return {
        route,
        materializedPath,
        expectUnauthenticated: unauthenticatedStatus,
        expectSuccess: 200,
      };
    }
    case 'global-role':
      return {
        route,
        materializedPath,
        expectUnauthenticated: 401,
        expectForbidden: 403,
        expectSuccess: 200,
      };
    case 'org-permission': {
      const unauthenticatedStatus =
        route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH'
          ? [400, 401, 422]
          : 401;
      return {
        route,
        materializedPath,
        expectUnauthenticated: unauthenticatedStatus,
        expectForbidden: 403,
        expectSuccess: 200,
      };
    }
    default:
      return {
        route,
        materializedPath,
        expectUnauthenticated: 401,
      };
  }
}

export type RouteSmokeFixtures = {
  token?: string;
  organizationPublicId?: string;
  tokenWithoutPermission?: string;
};

export async function assertRouteSmokeUnauthenticated(
  application: FastifyInstance,
  smokeCase: RouteSmokeCase,
): Promise<InjectHttpResult> {
  const response = await injectUnauthenticated(application, {
    method: smokeCase.route.method,
    url: smokeCase.materializedPath,
    payload:
      smokeCase.route.method === 'GET' || smokeCase.route.method === 'DELETE' ? undefined : {},
  });
  if (Array.isArray(smokeCase.expectUnauthenticated)) {
    expect(smokeCase.expectUnauthenticated).toContain(response.statusCode);
  } else {
    expect(response.statusCode).toBe(smokeCase.expectUnauthenticated);
  }
  return response;
}

export async function assertRouteSmokeForbidden(
  application: FastifyInstance,
  smokeCase: RouteSmokeCase,
  fixtures: RouteSmokeFixtures,
): Promise<InjectHttpResult> {
  if (!fixtures.tokenWithoutPermission) {
    throw new Error('tokenWithoutPermission required for forbidden assertion');
  }
  const response = await injectAuthenticated(application, {
    method: smokeCase.route.method,
    url: smokeCase.materializedPath,
    token: fixtures.tokenWithoutPermission,
    ...(fixtures.organizationPublicId !== undefined
      ? { organizationPublicId: fixtures.organizationPublicId }
      : {}),
    ...(smokeCase.route.method !== 'GET' && smokeCase.route.method !== 'DELETE'
      ? { payload: {} }
      : {}),
  });
  const expected = smokeCase.expectForbidden ?? 403;
  expect([expected, 404]).toContain(response.statusCode);
  return response;
}
