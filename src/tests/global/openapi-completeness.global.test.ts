/**
 * OpenAPI completeness — no bare generic request bodies; catalog routes appear in spec.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES_WITHOUT_JSON_BODY } from '@tooling/openapi/routes-without-json-body.js';
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';

const OPENAPI_PATH = join(process.cwd(), 'docs', 'openapi', 'openapi.json');

function isBareGenericObjectSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }
  const record = schema as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 1 && record.type === 'object';
}

function normalizeOpenApiPath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

function collectOpenApiRouteKeys(spec: {
  paths: Record<string, Record<string, { requestBody?: unknown }>>;
}): Set<string> {
  const keys = new Set<string>();
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    const normalizedPath = normalizeOpenApiPath(path);
    for (const [method] of Object.entries(pathItem)) {
      keys.add(`${method.toUpperCase()} ${normalizedPath}`);
    }
  }
  return keys;
}

describe('OpenAPI completeness', () => {
  const spec = JSON.parse(readFileSync(OPENAPI_PATH, 'utf-8')) as {
    paths: Record<string, Record<string, { requestBody?: unknown }>>;
  };

  it('has no bare generic JSON request body schemas', () => {
    const violations: string[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        const routeKey = `${method.toUpperCase()} ${path}`;
        if (ROUTES_WITHOUT_JSON_BODY.has(routeKey)) {
          continue;
        }

        const requestBody = operation.requestBody as
          | { content?: { 'application/json'?: { schema?: unknown } } }
          | undefined;
        const schema = requestBody?.content?.['application/json']?.schema;
        if (schema && isBareGenericObjectSchema(schema)) {
          violations.push(routeKey);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  const isOpenApiCatalogRoute = (route: { access: string; path: string }) =>
    route.access !== 'bearer-token' && !route.path.startsWith('/mcp');

  it('includes every OpenAPI-documentable route from docs/routes.txt', () => {
    const registry = loadRouteRegistryFromCatalog();
    const openApiKeys = collectOpenApiRouteKeys(spec);

    const allowlistedMissing = new Set<string>([
      // Registered outside domain *.routes.ts scan (health is added explicitly in generator)
    ]);

    const missing: string[] = [];
    for (const route of registry.filter(isOpenApiCatalogRoute)) {
      const openApiPath = normalizeOpenApiPath(route.path.replace(/:([^/]+)/g, '{$1}'));
      const key = `${route.method} ${openApiPath}`;
      if (!(openApiKeys.has(key) || allowlistedMissing.has(key))) {
        missing.push(key);
      }
    }

    expect(
      missing,
      `OpenAPI missing ${missing.length} catalog route(s). Run pnpm docs:generate. First: ${missing.slice(0, 5).join(', ')}`,
    ).toEqual([]);
  });

  it('documents at least as many operations as the route catalog', () => {
    const openApiCatalogRouteCount =
      loadRouteRegistryFromCatalog().filter(isOpenApiCatalogRoute).length;
    expect(collectOpenApiRouteKeys(spec).size).toBeGreaterThanOrEqual(openApiCatalogRouteCount);
  });
});
