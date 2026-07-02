import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURSOR_PAGINATED_LIST_ROUTE_KEYS,
  CURSOR_PAGINATION_DESCRIPTION_SUFFIX,
} from '@tooling/openapi/pagination-openapi.js';
import {
  getPathParameterDescription,
  getPathParameterExample,
  getPathParameterSchema,
} from '@tooling/openapi/enrichers/path-parameters.js';
import type { OpenApiLocaleStrings } from '@tooling/openapi/extractors/locale-loader.js';
import { collectRoutes } from '@tooling/openapi/extractors/route-extractor.js';
import { collectRouteSchemaMetadata } from '@tooling/openapi/extractors/route-schema-metadata.js';
import {
  generateOperationId,
  getQueryParameters,
  getRequestBodySchema,
  getRouteSecurity,
  inferTagFromPath,
} from './operation-helpers.js';
import {
  MCP_STREAMABLE_HTTP_POST_REQUEST_BODY,
  buildMcpCapabilitiesMarkdown,
  buildMcpOpenApiExtension,
  getMcpComponentSchemas,
  isMcpOpenApiPath,
} from '@tooling/openapi/mcp-openapi.js';
import { buildHeaderParameters } from './header-parameters.js';
import { buildResponses } from './responses-builder.js';
import { loadCapturedRouteExamples } from '@tooling/openapi/route-examples/loader.js';
import { PROJECT_OPENAPI_TITLE } from '@/shared/constants/project-identity.constants.js';
import { buildTagDefinitions } from './tag-definitions.js';

/** Sanitized request/response samples captured from real test-suite API calls. */
const capturedExamplesByRouteKey = loadCapturedRouteExamples();

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; description: string; version: string };
  servers: Array<{ url: string; description: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, object>>;
  components: {
    securitySchemes: Record<string, object>;
    schemas?: Record<string, object>;
  };
  'x-mcp'?: ReturnType<typeof buildMcpOpenApiExtension>;
  'x-tagGroups'?: Array<{ name: string; tags: string[] }>;
};

export function buildOpenApiDocument(localeStrings: OpenApiLocaleStrings): OpenApiDocument {
  const routes = collectRoutes();
  const schemaMetadataByRouteKey = collectRouteSchemaMetadata();
  const tagSet = new Set<string>();
  const paths: Record<string, Record<string, object>> = {};
  const responseStrings = localeStrings.responses ?? {};

  for (const { method, path } of routes) {
    const openapiPath = path.replace(/:([^/]+)/g, '{$1}');
    if (!paths[openapiPath]) paths[openapiPath] = {};

    const operation = method.toLowerCase();
    const routeKey = `${method} ${openapiPath}`;
    const schemaMetadata = schemaMetadataByRouteKey.get(routeKey);
    const metadata = schemaMetadata
      ? {
          summary: schemaMetadata.summary ?? undefined,
          description: schemaMetadata.description ?? undefined,
          tags: schemaMetadata.tags ?? undefined,
        }
      : undefined;

    const pathParameters: object[] = [];
    const parameterRegex = /\{([^}]+)\}/g;
    for (const parameterMatch of openapiPath.matchAll(parameterRegex)) {
      const parameterName = parameterMatch[1];
      if (!parameterName) continue;
      pathParameters.push({
        name: parameterName,
        in: 'path',
        required: true,
        description: getPathParameterDescription(parameterName),
        schema: getPathParameterSchema(parameterName),
        example: getPathParameterExample(parameterName),
      });
    }

    const tags = metadata?.tags ?? [inferTagFromPath(openapiPath)];
    for (const tag of tags) tagSet.add(tag);

    const queryParameters = getQueryParameters(method, openapiPath);
    const headerParameters = buildHeaderParameters(method, routeKey);
    const allParameters = [...pathParameters, ...queryParameters, ...headerParameters];

    const baseDescription = metadata?.description;
    let description = CURSOR_PAGINATED_LIST_ROUTE_KEYS.includes(
      routeKey as (typeof CURSOR_PAGINATED_LIST_ROUTE_KEYS)[number],
    )
      ? `${baseDescription ?? ''}${CURSOR_PAGINATION_DESCRIPTION_SUFFIX}`
      : baseDescription;

    if (isMcpOpenApiPath(openapiPath) && baseDescription) {
      description = `${baseDescription}\n\n${buildMcpCapabilitiesMarkdown()}`;
    }

    const operationObject: Record<string, unknown> = {
      tags,
      summary: metadata?.summary ?? `${method} ${path}`,
      description,
      operationId: generateOperationId(method, openapiPath),
      parameters: allParameters.length > 0 ? allParameters : undefined,
      security: getRouteSecurity(tags, routeKey),
      responses: buildResponses(method, routeKey, responseStrings),
    };

    if (isMcpOpenApiPath(openapiPath) && operation === 'post') {
      operationObject.requestBody = MCP_STREAMABLE_HTTP_POST_REQUEST_BODY;
    } else if (['post', 'patch', 'put'].includes(operation)) {
      const schema = getRequestBodySchema(method, openapiPath);
      if (schema) {
        const capturedRequestBody = capturedExamplesByRouteKey[routeKey]?.request_body;
        operationObject.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema,
              ...(schema.example ? { example: schema.example } : {}),
              ...(capturedRequestBody !== undefined
                ? {
                    examples: {
                      captured: {
                        summary: 'Captured from a live API call in the test suite (sanitized)',
                        value: capturedRequestBody,
                      },
                    },
                  }
                : {}),
            },
          },
        };
      }
    }

    paths[openapiPath][operation] = operationObject;
  }

  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
  const version: string = packageJson.version ?? '1.0.0';

  const tagGroupDefinitions: Array<{ name: string; tags: string[] }> = [
    { name: 'Platform', tags: ['Health', 'MCP'] },
    {
      name: 'Authentication',
      tags: [
        'Auth',
        'Magic Link',
        'OAuth',
        'Password',
        'Email Verification',
        'MFA',
        'Token',
        'Session',
        'Auth Method',
      ],
    },
    {
      name: 'Users',
      tags: ['User', 'User Settings', 'Notification Preferences', 'Admin', 'User Management'],
    },
    {
      name: 'Tenancy',
      tags: [
        'Organization',
        'Organization Settings',
        'API Key',
        'Notification Policy',
        'Audit Log',
        'Membership',
        'Invitation',
        'Role',
        'Permission',
      ],
    },
    {
      name: 'Billing',
      tags: ['Billing', 'Plan', 'Subscription', 'Stripe Webhook'],
    },
    { name: 'Notifications', tags: ['Notification', 'Webhook'] },
    { name: 'Uploads', tags: ['Upload'] },
  ];

  const tagGroups = tagGroupDefinitions
    .map((group) => ({
      name: group.name,
      tags: group.tags.filter((tag) => tagSet.has(tag)),
    }))
    .filter((group) => group.tags.length > 0);

  // Per-environment base URL: setup:infra sets OPENAPI_SERVER_URL when generating an environment's
  // Postman collection / Scalar doc so the artifact points at that env's API. Unset (normal
  // `docs:generate` / CI) → the default localhost server, so the committed spec is unchanged.
  const serverOverrideUrl = process.env.OPENAPI_SERVER_URL?.trim();
  const servers = serverOverrideUrl
    ? [
        {
          url: serverOverrideUrl,
          description: process.env.OPENAPI_SERVER_DESCRIPTION?.trim() || 'API server',
        },
      ]
    : [
        {
          url: 'http://localhost:3000',
          description: localeStrings.servers?.local ?? 'Local development',
        },
      ];

  return {
    openapi: '3.0.0',
    info: {
      title: localeStrings.info?.title ?? PROJECT_OPENAPI_TITLE,
      description:
        localeStrings.info?.description ??
        'Backend API for the Core platform. Includes authentication, multi-tenant organization management, billing, notifications, webhooks, and admin operations.\n\nAll authenticated endpoints require a Bearer JWT token in the Authorization header. Organization-scoped endpoints also require the appropriate permission.',
      version,
    },
    servers,
    tags: buildTagDefinitions(tagSet, localeStrings.tags),
    paths,
    'x-tagGroups': tagGroups,
    'x-mcp': buildMcpOpenApiExtension(),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            localeStrings.components?.bearerAuthDescription ??
            'JWT access token obtained from the login or token refresh endpoint.',
        },
      },
      schemas: getMcpComponentSchemas(),
    },
  };
}

export function countRoutes(document: OpenApiDocument): number {
  let count = 0;
  for (const pathItem of Object.values(document.paths)) {
    count += Object.keys(pathItem).length;
  }
  return count;
}
