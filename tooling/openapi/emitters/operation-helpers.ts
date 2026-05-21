import { type ZodTypeAny, toJSONSchema } from 'zod';
import { enrichSchema } from '@tooling/openapi/enrichers/schema-enricher.js';
import { routeSchemaMap } from '@tooling/openapi/schema-map.js';
import { routeQuerySchemaMap } from '@tooling/openapi/query-schema-map.js';
import { zodToOpenApiQueryParameters } from '@tooling/openapi/query-parameters.js';
import { ROUTES_WITHOUT_JSON_BODY } from '@tooling/openapi/routes-without-json-body.js';

export function zodToOpenApiSchema(zodSchema: ZodTypeAny): Record<string, unknown> {
  const jsonSchema = toJSONSchema(zodSchema, {
    target: 'openapi-3.0',
    reused: 'inline',
    cycles: 'throw',
  }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return enrichSchema(jsonSchema);
}

export function getQueryParameters(method: string, openapiPath: string): object[] {
  const key = `${method} ${openapiPath}`;
  const zodSchema = routeQuerySchemaMap[key];
  if (!zodSchema) return [];
  return zodToOpenApiQueryParameters(zodSchema);
}

export function getRequestBodySchema(
  method: string,
  openapiPath: string,
): Record<string, unknown> | null {
  const key = `${method} ${openapiPath}`;
  if (ROUTES_WITHOUT_JSON_BODY.has(key)) return null;
  const zodSchema = routeSchemaMap[key];
  if (!zodSchema) return null;
  return zodToOpenApiSchema(zodSchema);
}

export function getRouteSecurity(tags: string[]): object[] | undefined {
  if (tags.includes('Health')) return undefined;
  const routeKey = tags.join('/');
  if (routeKey === 'Billing/Plan') return undefined;
  return [{ bearerAuth: [] }];
}

export function generateOperationId(method: string, openapiPath: string): string {
  const cleaned = openapiPath
    .replace(/\/api\/v1\//, '')
    .replace(/\{([^}]+)\}/g, 'By$1')
    .replace(/[/-]/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/);
  const camelCase = words
    .map((word, index) =>
      index === 0 && method.toLowerCase() !== 'get'
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('');

  return method.toLowerCase() + camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
}

export function inferTagFromPath(openapiPath: string): string {
  const segments = openapiPath.replace('/api/v1/', '').split('/');
  const first = segments[0];
  if (!first) return 'General';
  return first.charAt(0).toUpperCase() + first.slice(1);
}
